import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/anomalies — Detect unusual spending patterns
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const now = new Date();

    // Get current and previous month expenses
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const _prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const _prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Get 6 months for baseline
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

    const expenses = await prisma.expense.findMany({
      take: 10000,
      where: { userId, organizationId, date: { gte: sixMonthsAgo } },
      include: { category: true },
      orderBy: { date: "desc" },
    });

    // Group by category and month
    const categoryMonthly: Record<string, number[]> = {};
    const monthlyTotals: Record<string, number> = {};

    for (const e of expenses) {
      const cat = e.category?.name || "Uncategorized";
      const monthKey = e.date.toISOString().slice(0, 7);

      if (!categoryMonthly[cat]) categoryMonthly[cat] = [];
      categoryMonthly[cat].push(Number(e.amount));

      monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + Number(e.amount);
    }

    const anomalies: Array<{
      type: "spike" | "new_category" | "unusual_amount" | "budget_warning";
      severity: "high" | "medium" | "low";
      title: string;
      description: string;
      amount?: number;
      threshold?: number;
    }> = [];

    // Detect category spending spikes
    for (const [cat, amounts] of Object.entries(categoryMonthly)) {
      if (amounts.length < 3) continue;
      const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const latest = amounts[0];

      if (latest > avg * 2 && latest > 5000) {
        anomalies.push({
          type: "spike",
          severity: latest > avg * 3 ? "high" : "medium",
          title: `${cat} spending spike`,
          description: `Latest: ₹${latest.toLocaleString("en-IN")} vs avg ₹${Math.round(avg).toLocaleString("en-IN")} (${Math.round((latest / avg - 1) * 100)}% above normal)`,
          amount: latest,
          threshold: Math.round(avg),
        });
      }
    }

    // Monthly total comparison
    const monthKeys = Object.keys(monthlyTotals).sort();
    if (monthKeys.length >= 2) {
      const currentTotal = monthlyTotals[monthKeys[monthKeys.length - 1]] || 0;
      const prevTotal = monthlyTotals[monthKeys[monthKeys.length - 2]] || 0;
      const allTotals = Object.values(monthlyTotals);
      const _avgTotal = allTotals.reduce((s, t) => s + t, 0) / allTotals.length;

      if (currentTotal > prevTotal * 1.3 && currentTotal > 10000) {
        const pctIncrease = prevTotal > 0 ? Math.round((currentTotal / prevTotal - 1) * 100) : 100;
        anomalies.push({
          type: "spike",
          severity: "medium",
          title: "Overall spending increase",
          description: `This month: ₹${currentTotal.toLocaleString("en-IN")} vs last month: ₹${prevTotal.toLocaleString("en-IN")} (+${pctIncrease}%)`,
          amount: currentTotal,
          threshold: prevTotal,
        });
      }
    }

    // Check for unusually large single transactions
    const currentMonthExpenses = expenses.filter((e) => e.date >= currentMonthStart);
    const allAmounts = expenses.map((e) => Number(e.amount));
    const avgAmount = allAmounts.length > 0 ? allAmounts.reduce((s, a) => s + a, 0) / allAmounts.length : 0;

    for (const e of currentMonthExpenses) {
      const amt = Number(e.amount);
      if (amt > avgAmount * 5 && amt > 20000) {
        anomalies.push({
          type: "unusual_amount",
          severity: "high",
          title: `Large transaction: ${e.description || e.vendor || "Unknown"}`,
          description: `₹${amt.toLocaleString("en-IN")} — ${Math.round(amt / avgAmount)}x the average transaction size`,
          amount: amt,
          threshold: Math.round(avgAmount),
        });
      }
    }

    // Budget check — use organizationId from requireTenant() directly
    const budgets = await prisma.budgetThreshold.findMany({ where: { organizationId }, take: 500 });
    for (const b of budgets) {
      const catExpenses = expenses.filter(
        (e) => e.category?.name === b.category && e.date >= currentMonthStart
      );
      const spent = catExpenses.reduce((s, e) => s + Number(e.amount), 0);
      const limit = Number(b.monthlyLimit);

      if (spent > limit * 0.9) {
        anomalies.push({
          type: "budget_warning",
          severity: spent > limit ? "high" : "medium",
          title: `${b.category} budget ${spent > limit ? "exceeded" : "warning"}`,
          description: `Spent ₹${spent.toLocaleString("en-IN")} of ₹${limit.toLocaleString("en-IN")} budget (${Math.round(spent / limit * 100)}%)`,
          amount: spent,
          threshold: limit,
        });
      }
    }

    anomalies.sort((a, b) => {
      const sev = { high: 0, medium: 1, low: 2 };
      return sev[a.severity] - sev[b.severity];
    });

    return NextResponse.json({
      anomalies,
      summary: {
        total: anomalies.length,
        high: anomalies.filter((a) => a.severity === "high").length,
        medium: anomalies.filter((a) => a.severity === "medium").length,
        low: anomalies.filter((a) => a.severity === "low").length,
      },
    });
  } catch (error) {
    log.error("Anomaly detection error", { module: "anomalies", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
