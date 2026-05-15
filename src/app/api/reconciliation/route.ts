import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const ReconciliationSchema = z.object({
  transactionId: z.string().min(1, "transactionId required"),
  matchType: z.enum(["expense", "revenue", "invoice"]).optional(),
  matchId: z.string().optional(),
  category: z.string().max(100).optional(),
});

/**
 * GET /api/reconciliation — Get unmatched bank transactions with suggestions
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    // Bank transactions not yet reconciled
    const unmatched = await prisma.bankTransaction.findMany({
      take: 5000,
      where: {
        userId,
        isReconciled: false,
      },
      orderBy: { date: "desc" },
    });

    // Get recent expenses and invoices for matching
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const [expenses, invoices] = await Promise.all([
      prisma.expense.findMany({
      take: 5000,
        where: { userId, organizationId, date: { gte: threeMonthsAgo } },
        include: { category: true },
        orderBy: { date: "desc" },
      }),
      prisma.invoice.findMany({
      take: 5000,
        where: { userId, organizationId, status: { in: ["paid", "partial"] }, paidAt: { gte: threeMonthsAgo } },
        include: { client: true },
        orderBy: { paidAt: "desc" },
      }),
    ]);

    // Generate match suggestions
    const suggestions = unmatched.map((txn) => {
      const txnAmount = Number(txn.amount);
      const txnDate = txn.date;
      const matches: Array<{
        type: string;
        id: string;
        description: string;
        amount: number;
        date: string;
        confidence: number;
      }> = [];

      if (txn.type === "debit") {
        // Match debits against expenses
        for (const exp of expenses) {
          const expAmount = Number(exp.amount);
          const amountDiff = Math.abs(txnAmount - expAmount);
          const dateDiff = Math.abs(txnDate.getTime() - exp.date.getTime()) / 86400000;

          if (amountDiff < 1 && dateDiff <= 3) {
            matches.push({
              type: "expense",
              id: exp.id,
              description: exp.description,
              amount: expAmount,
              date: exp.date.toISOString(),
              confidence: amountDiff < 0.01 && dateDiff <= 1 ? 0.95 : 0.8,
            });
          } else if (amountDiff < txnAmount * 0.05 && dateDiff <= 7) {
            matches.push({
              type: "expense",
              id: exp.id,
              description: exp.description,
              amount: expAmount,
              date: exp.date.toISOString(),
              confidence: 0.5,
            });
          }
        }
      } else {
        // Match credits against invoices
        for (const inv of invoices) {
          const invAmount = Number(inv.total);
          const amountDiff = Math.abs(txnAmount - invAmount);
          const invDate = inv.paidAt || inv.issueDate;
          const dateDiff = Math.abs(txnDate.getTime() - invDate.getTime()) / 86400000;

          if (amountDiff < 1 && dateDiff <= 5) {
            matches.push({
              type: "invoice",
              id: inv.id,
              description: `${inv.invoiceNumber} — ${inv.client?.name || "Unknown"}`,
              amount: invAmount,
              date: invDate.toISOString(),
              confidence: amountDiff < 0.01 && dateDiff <= 1 ? 0.95 : 0.75,
            });
          }
        }
      }

      // Sort by confidence
      matches.sort((a, b) => b.confidence - a.confidence);

      return {
        id: txn.id,
        date: txn.date.toISOString(),
        description: txn.description,
        amount: txnAmount,
        type: txn.type,
        category: txn.category,
        suggestions: matches.slice(0, 3),
        bestMatch: matches[0] || null,
      };
    });

    const totalUnmatched = suggestions.length;
    const withSuggestions = suggestions.filter((s) => s.bestMatch).length;

    return NextResponse.json({
      unmatched: suggestions,
      summary: {
        totalUnmatched,
        withSuggestions,
        autoMatchable: suggestions.filter((s) => s.bestMatch && s.bestMatch.confidence >= 0.9).length,
      },
    });
  } catch (error) {
    log.error("Reconciliation error", { module: "reconciliation", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load reconciliation" }, { status: 500 });
  }
}

/**
 * POST /api/reconciliation — Match a bank transaction to an expense, invoice, or revenue
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "reconciliation" });
    if (limited) return limited;
    const rawBody = await request.json();
    const parsed = ReconciliationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { transactionId, matchType, matchId, category } = parsed.data;

    // RELIABILITY: Atomic reconciliation — transaction marking + entity linking must succeed together
    await prisma.$transaction(async (tx) => {
      // Mark transaction as reconciled
      const updateData: Record<string, unknown> = { isReconciled: true };
      if (category) updateData.category = category;

      await tx.bankTransaction.update({
        where: { id: transactionId },
        data: updateData,
      });

      // If matching to an expense, link them
      if (matchType === "expense" && matchId) {
        await tx.expense.update({
          where: { id: matchId },
          data: { source: "bank_reconciled", sourceId: transactionId },
        });
      }

      // If matching to a revenue entry, link and populate category
      if (matchType === "revenue" && matchId) {
        const updateRevData: Record<string, string> = {
          sourceId: transactionId,
          source: "bank_reconciled",
        };
        if (category) updateRevData.category = category;
        await tx.revenue.update({
          where: { id: matchId },
          data: updateRevData,
        });
      }

      // If matching to an invoice, mark as paid
      if (matchType === "invoice" && matchId) {
        await tx.invoice.update({
          where: { id: matchId },
          data: { status: "paid", paidAt: new Date() },
        });
      }
    });

    return NextResponse.json({ success: true, matched: { transactionId, matchType, matchId } });
  } catch (error) {
    log.error("Reconciliation match error", { module: "reconciliation", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to reconcile" }, { status: 500 });
  }
}
