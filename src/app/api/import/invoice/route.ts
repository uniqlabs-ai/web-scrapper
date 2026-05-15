import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const InvoiceImportFileSchema = z.object({
  fileName: z.string().min(1).max(500).refine(n => n.toLowerCase().endsWith(".pdf"), "Only PDF files are supported"),
  sizeBytes: z.number().max(50 * 1024 * 1024, "File exceeds 50MB limit"),
});

/**
 * POST /api/import/invoice — Parse & import an invoice PDF
 * 
 * - Extracts invoice data via Python parser (scripts/extract_invoice.py)
 * - Creates Invoice + InvoiceLineItems
 * - Upserts Client from billedTo
 * - Smart-matches against existing Revenue entries (date ±30d, amount ±5%)
 * - Links invoice to matching revenue via sourceId
 */
export async function POST(request: Request) {
  try {
    const { userId, organizationId } = await requireTenant();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileParsed = InvoiceImportFileSchema.safeParse({ fileName: file.name, sizeBytes: file.size });
    if (!fileParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: fileParsed.error.issues }, { status: 400 });
    }

    // Write file to temp location
    const bytes = await file.arrayBuffer();
    const tmpPath = path.join(os.tmpdir(), `invoice_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, Buffer.from(bytes));

    // Run Python parser
    const scriptPath = path.join(process.cwd(), "scripts", "extract_invoice.py");
    let parsed;
    try {
      const output = execSync(`python3 "${scriptPath}" "${tmpPath}"`, {
        encoding: "utf-8",
        timeout: 30000,
      });
      parsed = JSON.parse(output.trim());
    } catch (parseErr: unknown) {
      log.error("Invoice parse failed", { module: "import", action: "invoice", error: toLogError(parseErr) });
      const msg = parseErr instanceof Error ? parseErr.message : "Unknown error";
      return NextResponse.json({ error: "Failed to parse invoice PDF", details: msg }, { status: 422 });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (e: unknown) {
        log.warn("Failed to cleanup temp file", { module: "import", action: "invoice", meta: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }

    // Filter out zero-value line items
    const lineItems = (parsed.lineItems || []).filter(
      (item: { amount: number }) => item.amount > 0
    );

    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No non-zero line items found in invoice" }, { status: 422 });
    }

    // Upsert client from billedTo
    let clientId: string | null = null;
    const clientName = parsed.billedTo?.name;
    if (clientName && clientName.length > 2) {
      const existing = await prisma.client.findFirst({
        where: { userId, name: { contains: clientName, mode: "insensitive" } },
      });
      if (existing) {
        clientId = existing.id;
      } else {
        const newClient = await prisma.client.create({
          data: {
            userId,
            organizationId: user?.organizationId,
            name: clientName,
            email: "",
            address: parsed.billedTo?.address || "",
          },
        });
        clientId = newClient.id;
      }
    }

    // Create invoice
    const invoiceDate = parsed.date ? new Date(parsed.date) : new Date();
    const dueDate = parsed.dueDate ? new Date(parsed.dueDate) : new Date(invoiceDate.getTime() + 30 * 86400000);

    const invoice = await prisma.invoice.create({
      data: {
        userId,
        organizationId: user?.organizationId || undefined,
        invoiceNumber: parsed.reference || parsed.invoiceNumber || `INV-${Date.now()}`,
        status: "sent",
        issueDate: invoiceDate,
        dueDate,
        subtotal: parsed.subtotal || parsed.total || 0,
        taxTotal: parsed.tax || 0,
        total: parsed.total || 0,
        currency: parsed.currency || "INR",
        gstNumber: parsed.gstin || undefined,
        notes: `Imported from ${file.name} | Format: ${parsed.format} | PO: ${parsed.purchaseOrder || "N/A"}`,
        clientId,
        lineItems: {
          create: lineItems.map((item: { description: string; qty: number; rate: number; amount: number }) => ({
            description: item.description,
            quantity: item.qty || 1,
            unitPrice: item.rate || item.amount,
            amount: item.amount,
            total: item.amount,
            gstRate: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
          })),
        },
      },
      include: { lineItems: true, client: true },
    });

    // Smart match against existing Revenue entries
    // Look for revenue within ±30 days and ±5% amount
    let revenueMatch = null;
    const totalAmount = Number(parsed.total);
    const searchStart = new Date(invoiceDate);
    searchStart.setDate(searchStart.getDate() - 30);
    const searchEnd = new Date(invoiceDate);
    searchEnd.setDate(searchEnd.getDate() + 30);

    const candidateRevenues = await prisma.revenue.findMany({
      take: 500,
      where: {
        userId,
        month: { gte: searchStart, lte: searchEnd },
      },
      orderBy: { month: "desc" },
    });

    for (const rev of candidateRevenues) {
      const revAmount = Number(rev.amount);
      const amountDiff = Math.abs(revAmount - totalAmount) / Math.max(totalAmount, 1);
      if (amountDiff <= 0.05) {
        // Link the invoice to this revenue entry
        await prisma.revenue.update({
          where: { id: rev.id },
          data: {
            sourceId: invoice.id,
            source: "invoice_matched",
            category: rev.category || "Invoice Payment",
          },
        });
        revenueMatch = {
          revenueId: rev.id,
          revenueAmount: revAmount,
          revenueDate: rev.month,
          matchConfidence: amountDiff < 0.01 ? 0.95 : 0.85,
        };
        break;
      }
    }

    // Create import batch record
    await prisma.importBatch.create({
      data: {
        type: "invoice",
        fileName: file.name,
        rowCount: lineItems.length,
        status: "completed",
        columnMapping: JSON.stringify({
          format: parsed.format,
          invoiceNumber: parsed.invoiceNumber,
          reference: parsed.reference,
          purchaseOrder: parsed.purchaseOrder,
          currency: parsed.currency,
        }),
        userId,
      },
    });

    return NextResponse.json({
      success: true,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        total: Number(invoice.total),
        currency: invoice.currency,
        date: invoice.issueDate,
        dueDate: invoice.dueDate,
        client: invoice.client?.name || null,
        lineItems: invoice.lineItems.length,
      },
      parsed: {
        format: parsed.format,
        reference: parsed.reference,
        purchaseOrder: parsed.purchaseOrder,
        gstin: parsed.gstin,
        bankDetails: parsed.bankDetails,
      },
      revenueMatch,
    });
  } catch (error) {
    log.error("Invoice import error", { module: "import", action: "invoice", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to import invoice" }, { status: 500 });
  }
}
