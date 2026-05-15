import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const EmptyBodySchema = z.object({}).strict();

/**
 * POST /api/reconciliation/auto — AI Auto-reconcile with REVIEW workflow
 * 
 * Instead of immediately reconciling, returns proposed matches for user review.
 * Also matches CREDIT transactions against Revenue entries (not just invoices).
 * Populates categories on matched entries.
 */
export async function POST() {
  try {
    const _validated = EmptyBodySchema.safeParse({});
    const { userId, organizationId } = await requireTenant();

    // Get unreconciled bank transactions
    const unreconciledTxns = await prisma.bankTransaction.findMany({
      take: 5000,
      where: { userId, isReconciled: false },
      orderBy: { date: "desc" },
    });

    if (unreconciledTxns.length === 0) {
      return NextResponse.json({
        matched: 0,
        total: 0,
        pendingReview: [],
        message: "No unreconciled transactions",
      });
    }

    // Get all expenses, invoices, and revenue for matching
    const expenses = await prisma.expense.findMany({
      take: 5000,
      where: { userId, organizationId },
      include: { category: true },
      orderBy: { date: "desc" },
    });

    const invoices = await prisma.invoice.findMany({
      take: 5000,
      where: { userId, organizationId },
      include: { payments: true, client: true },
      orderBy: { issueDate: "desc" },
    });

    const revenues = await prisma.revenue.findMany({
      take: 5000,
      where: { userId, organizationId },
      orderBy: { month: "desc" },
    });

    const pendingReview: Array<{
      transactionId: string;
      transactionDesc: string;
      transactionAmount: number;
      transactionDate: string;
      transactionType: string;
      matchType: string;
      matchId: string;
      matchDesc: string;
      matchAmount: number;
      matchDate: string;
      confidence: number;
      suggestedCategory: string | null;
    }> = [];

    for (const txn of unreconciledTxns) {
      const txnAmount = Number(txn.amount);
      const txnDate = new Date(txn.date);
      const txnDesc = (txn.description || "").toLowerCase();

      let bestMatch: {
        type: string;
        id: string;
        desc: string;
        amount: number;
        date: Date;
        confidence: number;
        category: string | null;
      } | null = null;

      // DEBIT transactions → match to expenses
      if (txn.type === "debit") {
        for (const exp of expenses) {
          const expAmount = Number(exp.amount);
          const expDate = new Date(exp.date);

          // Exact amount match
          if (Math.abs(txnAmount - expAmount) < 1) {
            const dayDiff = Math.abs(txnDate.getTime() - expDate.getTime()) / (1000 * 60 * 60 * 24);

            if (dayDiff <= 3) {
              const conf = dayDiff === 0 ? 0.95 : dayDiff <= 1 ? 0.9 : 0.8;
              if (!bestMatch || conf > bestMatch.confidence) {
                bestMatch = {
                  type: "expense",
                  id: exp.id,
                  desc: exp.description,
                  amount: expAmount,
                  date: expDate,
                  confidence: conf,
                  category: exp.category?.name || null,
                };
              }
            } else if (dayDiff <= 7) {
              const descMatch = exp.description && txnDesc.includes(exp.description.toLowerCase().substring(0, 8));
              const conf = descMatch ? 0.75 : 0.6;
              if (!bestMatch || conf > bestMatch.confidence) {
                bestMatch = {
                  type: "expense",
                  id: exp.id,
                  desc: exp.description,
                  amount: expAmount,
                  date: expDate,
                  confidence: conf,
                  category: exp.category?.name || null,
                };
              }
            }
          }

          // Fuzzy amount (within 2%) + same day
          const amountDiffPct = Math.abs(txnAmount - expAmount) / Math.max(txnAmount, 1);
          if (amountDiffPct < 0.02) {
            const dayDiff = Math.abs(txnDate.getTime() - expDate.getTime()) / (1000 * 60 * 60 * 24);
            if (dayDiff <= 1 && (!bestMatch || 0.7 > bestMatch.confidence)) {
              bestMatch = {
                type: "expense",
                id: exp.id,
                desc: exp.description,
                amount: expAmount,
                date: expDate,
                confidence: 0.7,
                category: exp.category?.name || null,
              };
            }
          }
        }
      }

      // CREDIT transactions → match to invoices AND revenue
      if (txn.type === "credit") {
        // Check invoices first
        for (const inv of invoices) {
          const invTotal = Number(inv.total);
          const invDate = new Date(inv.issueDate);

          if (Math.abs(txnAmount - invTotal) < 1) {
            const dayDiff = Math.abs(txnDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24);
            if (dayDiff <= 30) {
              const conf = dayDiff <= 3 ? 0.95 : dayDiff <= 7 ? 0.85 : 0.7;
              if (!bestMatch || conf > bestMatch.confidence) {
                bestMatch = {
                  type: "invoice",
                  id: inv.id,
                  desc: `Invoice ${inv.invoiceNumber} — ${inv.client?.name || "Unknown"}`,
                  amount: invTotal,
                  date: invDate,
                  confidence: conf,
                  category: "Invoice Payment",
                };
              }
            }
          }

          // Check invoice client name in description
          if (inv.client?.name && txnDesc.includes(inv.client.name.toLowerCase().substring(0, 6))) {
            if (Math.abs(txnAmount - invTotal) < 1) {
              if (!bestMatch || 0.9 > bestMatch.confidence) {
                bestMatch = {
                  type: "invoice",
                  id: inv.id,
                  desc: `Invoice ${inv.invoiceNumber} — ${inv.client.name}`,
                  amount: invTotal,
                  date: invDate,
                  confidence: 0.9,
                  category: "Invoice Payment",
                };
              }
            }
          }
        }

        // Then check Revenue entries
        for (const rev of revenues) {
          const revAmount = Number(rev.amount);
          const revDate = new Date(rev.month);

          if (Math.abs(txnAmount - revAmount) < 1) {
            const dayDiff = Math.abs(txnDate.getTime() - revDate.getTime()) / (1000 * 60 * 60 * 24);
            if (dayDiff <= 30) {
              const conf = dayDiff <= 3 ? 0.9 : dayDiff <= 7 ? 0.8 : 0.65;
              // Only use revenue match if no invoice match or lower confidence
              if (!bestMatch || conf > bestMatch.confidence) {
                bestMatch = {
                  type: "revenue",
                  id: rev.id,
                  desc: `Revenue — ${rev.source || rev.category || "Uncategorized"}`,
                  amount: revAmount,
                  date: revDate,
                  confidence: conf,
                  category: rev.category || inferCategory(txnDesc),
                };
              }
            }
          }

          // Fuzzy amount (within 5%) + within 7 days
          const amountDiffPct = Math.abs(txnAmount - revAmount) / Math.max(txnAmount, 1);
          if (amountDiffPct < 0.05) {
            const dayDiff = Math.abs(txnDate.getTime() - revDate.getTime()) / (1000 * 60 * 60 * 24);
            if (dayDiff <= 7 && (!bestMatch || 0.6 > bestMatch.confidence)) {
              bestMatch = {
                type: "revenue",
                id: rev.id,
                desc: `Revenue — ${rev.source || rev.category || "Uncategorized"}`,
                amount: revAmount,
                date: revDate,
                confidence: 0.6,
                category: rev.category || inferCategory(txnDesc),
              };
            }
          }
        }
      }

      // Add to pending review if match found (confidence ≥ 0.5)
      if (bestMatch && bestMatch.confidence >= 0.5) {
        pendingReview.push({
          transactionId: txn.id,
          transactionDesc: txn.description || "Unknown",
          transactionAmount: txnAmount,
          transactionDate: txnDate.toISOString(),
          transactionType: txn.type || "unknown",
          matchType: bestMatch.type,
          matchId: bestMatch.id,
          matchDesc: bestMatch.desc,
          matchAmount: bestMatch.amount,
          matchDate: bestMatch.date.toISOString(),
          confidence: bestMatch.confidence,
          suggestedCategory: bestMatch.category,
        });
      }
    }

    return NextResponse.json({
      matched: 0, // Nothing committed yet — all pending
      total: unreconciledTxns.length,
      pendingReview,
      message: `Found ${pendingReview.length} potential matches for review`,
    });
  } catch (error) {
    log.error("Auto-reconcile error", { module: "reconciliation", action: "auto", error: toLogError(error) });
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 500 });
  }
}

/**
 * Infer category from transaction description
 */
function inferCategory(desc: string): string {
  const lower = desc.toLowerCase();
  if (lower.includes("salary") || lower.includes("payroll")) return "Payroll";
  if (lower.includes("rent") || lower.includes("lease")) return "Rent";
  if (lower.includes("insurance")) return "Insurance";
  if (lower.includes("software") || lower.includes("sas") || lower.includes("subscription")) return "SaaS Subscription";
  if (lower.includes("consulting") || lower.includes("professional")) return "Consulting";
  if (lower.includes("interest") || lower.includes("fd") || lower.includes("deposit")) return "Interest";
  if (lower.includes("commission")) return "Commission";
  if (lower.includes("service")) return "Service Revenue";
  return "Other";
}
