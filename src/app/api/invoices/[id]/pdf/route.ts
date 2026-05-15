import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { generateInvoicePDF } from "@/lib/pdf";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const InvoicePdfParamSchema = z.object({
  id: z.string().min(1, "Invoice ID is required"),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const rawParams = await params;
    const paramsParsed = InvoicePdfParamSchema.safeParse(rawParams);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: paramsParsed.error.issues }, { status: 400 });
    }
    const { id } = paramsParsed.data;

    const invoice = await prisma.invoice.findFirst({
      where: { id, userId, organizationId },
      include: {
        client: true,
        lineItems: true,
        organization: true,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    let paymentUpiId: string | undefined = undefined;
    if (invoice.organization?.alertSettings) {
      try {
        const settings = JSON.parse(invoice.organization.alertSettings);
        if (settings.paymentUpiId) paymentUpiId = settings.paymentUpiId;
      } catch (e: unknown) {
        log.warn("Malformed alertSettings JSON", { module: "invoices", action: "pdf", meta: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    const pdfBuffer = generateInvoicePDF({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      status: invoice.status,
      clientName: invoice.client?.name,
      clientEmail: invoice.client?.email || undefined,
      clientCompany: invoice.client?.company || undefined,
      clientAddress: invoice.client?.address || undefined,
      clientGstNumber: invoice.client?.gstNumber || undefined,
      companyName: invoice.organization?.name || undefined,
      companyAddress: invoice.organization?.address || undefined,
      companyGstNumber: invoice.organization?.gstNumber || undefined,
      lineItems: invoice.lineItems.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount),
        gstRate: Number(item.gstRate),
        cgst: Number(item.cgst),
        sgst: Number(item.sgst),
        igst: Number(item.igst),
        total: Number(item.total),
      })),
      subtotal: Number(invoice.subtotal),
      taxTotal: Number(invoice.taxTotal),
      total: Number(invoice.total),
      isInterState: invoice.isInterState ?? false,
      currency: invoice.currency,
      notes: invoice.notes || undefined,
      paymentUpiId,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    log.error("PDF generation error", { module: "invoices", action: "pdf", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
