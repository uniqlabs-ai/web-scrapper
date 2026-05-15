import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const ConfirmMatchSchema = z.object({
  invoiceId: z.string().min(1, "invoiceId is required"),
  transactionId: z.string().min(1, "transactionId is required"),
});

// GET: Find bank transactions that may match unpaid invoices
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    
    // Get all unpaid invoices
    const unpaidInvoices = await prisma.invoice.findMany({
      take: 500,
      where: { userId, organizationId, status: { in: ["sent", "overdue"] } },
      include: { client: true },
    });
    
    if (unpaidInvoices.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    // Get recent bank credits (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const bankCredits = await prisma.bankTransaction.findMany({
      take: 500,
      where: {
        userId,
        type: "credit",
        date: { gte: ninetyDaysAgo },
        isReconciled: false,
      },
      orderBy: { date: "desc" },
    });

    const suggestions: {
      invoiceId: string;
      invoiceNumber: string;
      invoiceTotal: number;
      clientName: string;
      transactionId: string;
      transactionDesc: string;
      transactionAmount: number;
      transactionDate: string;
      confidence: number;
      matchReason: string;
    }[] = [];

    for (const invoice of unpaidInvoices) {
      const invoiceTotal = Number(invoice.total);
      const clientName = invoice.client?.name || "";
      const clientCompany = invoice.client?.company || "";
      // Get client aliases
      const clientAliases: string[] = [];
      if (invoice.client) {
        const clientRecord = await prisma.client.findUnique({
          where: { id: invoice.clientId! },
          select: { aliases: true },
        });
        if (clientRecord?.aliases) {
          clientAliases.push(...(clientRecord.aliases as unknown as string[]));
        }
      }
      
      for (const txn of bankCredits) {
        const txnAmount = Number(txn.amount);
        const desc = txn.description.toLowerCase();
        
        // Amount matching (±5%)
        const amountDiff = Math.abs(txnAmount - invoiceTotal) / invoiceTotal;
        const amountMatch = amountDiff <= 0.05;
        
        // Exact amount match
        const exactMatch = Math.abs(txnAmount - invoiceTotal) < 1;
        
        // Name matching
        const nameTerms = [clientName, clientCompany, ...clientAliases]
          .filter(Boolean)
          .map((s) => s.toLowerCase());
        const nameMatch = nameTerms.some((term) => 
          term.length > 2 && desc.includes(term)
        );
        
        let confidence = 0;
        let matchReason = "";
        
        if (exactMatch && nameMatch) {
          confidence = 0.95;
          matchReason = "Exact amount + client name match";
        } else if (amountMatch && nameMatch) {
          confidence = 0.85;
          matchReason = "Amount (~5%) + client name match";
        } else if (exactMatch) {
          confidence = 0.65;
          matchReason = "Exact amount match (no name match)";
        } else if (amountMatch) {
          confidence = 0.45;
          matchReason = "Approximate amount match";
        }
        
        if (confidence >= 0.45) {
          suggestions.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceTotal,
            clientName: clientName || clientCompany || "Unknown",
            transactionId: txn.id,
            transactionDesc: txn.description,
            transactionAmount: txnAmount,
            transactionDate: txn.date.toISOString(),
            confidence,
            matchReason,
          });
        }
      }
    }

    // Sort by confidence (highest first), dedupe (one suggestion per invoice)
    suggestions.sort((a, b) => b.confidence - a.confidence);
    const seen = new Set<string>();
    const deduped = suggestions.filter((s) => {
      const key = s.invoiceId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({ suggestions: deduped });
  } catch (error) {
    log.error("Auto-match error", { module: "invoices", action: "auto-match", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to find matches" }, { status: 500 });
  }
}

// POST: Accept an auto-match — mark invoice as paid + reconcile bank transaction
export async function POST(request: Request) {
  try {
    const limited = rateLimit(request as NextRequest, { windowSec: 60, max: 15, prefix: "invoice-match" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = ConfirmMatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { invoiceId, transactionId } = parsed.data;

    // Mark invoice as paid
    await prisma.invoice.update({
      where: { id: invoiceId, userId, organizationId },
      data: { status: "paid" },
    });

    // Mark bank transaction as reconciled
    await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: { isReconciled: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Auto-match confirm error", { module: "invoices", action: "auto-match", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to confirm match" }, { status: 500 });
  }
}
