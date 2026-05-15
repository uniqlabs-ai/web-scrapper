import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/auth";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/health — Financial Health Score + AI Recommendations
 * Analyzes all financial data and produces actionable insights
 */
export async function GET() {
  try {
    const userId = await getAuthUserId();
    const now = new Date();
    const fyStart = now.getMonth() >= 3
      ? new Date(now.getFullYear(), 3, 1)
      : new Date(now.getFullYear() - 1, 3, 1);
    const _lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // ── Get user's org ────────────────────────────────────
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
    const orgId = user?.organizationId;

    // ── Fetch all data ──────────────────────────────────
    const [
      revenues, expenses, invoices, budgets, bankAccounts,
    ] = await Promise.all([
      prisma.revenue.findMany({ where: { userId, month: { gte: fyStart } }, take: 500 }),
      prisma.expense.findMany({
      take: 50,
        where: { userId, date: { gte: fyStart } },
        include: { category: true },
      }),
      prisma.invoice.findMany({
      take: 50,
        where: { userId },
        include: { lineItems: true, payments: true },
      }),
      orgId ? prisma.budgetThreshold.findMany({ where: { organizationId: orgId }, take: 100 }) : Promise.resolve([]),
      prisma.bankAccount.findMany({ where: { userId, isActive: true }, take: 100 }),
    ]);

    // ── Revenue Analysis ────────────────────────────────
    const totalRevenue = revenues.reduce((s, r) => s + Number(r.amount), 0);
    const monthlyRevenue: Record<string, number> = {};
    for (const r of revenues) {
      const key = r.month.toISOString().slice(0, 7);
      monthlyRevenue[key] = (monthlyRevenue[key] || 0) + Number(r.amount);
    }
    const revenueMonths = Object.values(monthlyRevenue);
    const avgMonthlyRevenue = revenueMonths.length > 0
      ? revenueMonths.reduce((s, v) => s + v, 0) / revenueMonths.length : 0;

    // Revenue trend (last 3 vs prev 3)
    const sortedRevMonths = Object.entries(monthlyRevenue).sort((a, b) => a[0].localeCompare(b[0]));
    const recentRev3 = sortedRevMonths.slice(-3).reduce((s, [, v]) => s + v, 0);
    const prevRev3 = sortedRevMonths.slice(-6, -3).reduce((s, [, v]) => s + v, 0);
    const revenueGrowth = prevRev3 > 0 ? Math.round(((recentRev3 - prevRev3) / prevRev3) * 100) : 0;

    // ── Expense Analysis ────────────────────────────────
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const monthlyExpenses: Record<string, number> = {};
    const categorySpend: Record<string, number> = {};
    for (const e of expenses) {
      const key = e.date.toISOString().slice(0, 7);
      monthlyExpenses[key] = (monthlyExpenses[key] || 0) + Number(e.amount);
      const cat = e.category?.name || "Uncategorized";
      categorySpend[cat] = (categorySpend[cat] || 0) + Number(e.amount);
    }
    const expenseMonths = Object.values(monthlyExpenses);
    const avgMonthlyExpenses = expenseMonths.length > 0
      ? expenseMonths.reduce((s, v) => s + v, 0) / expenseMonths.length : 0;

    // Top 5 expense categories
    const topCategories = Object.entries(categorySpend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({
        name,
        amount,
        pct: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
      }));

    // ── Profitability ───────────────────────────────────
    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

    // ── Cash Position ───────────────────────────────────
    const totalCash = bankAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);
    const runwayMonths = avgMonthlyExpenses > 0
      ? Math.round(totalCash / avgMonthlyExpenses) : Infinity;

    // ── Receivables (AR) ────────────────────────────────
    const unpaidInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled");
    const totalReceivables = unpaidInvoices.reduce((s, i) => s + Number(i.total), 0);
    const overdueInvoices = unpaidInvoices.filter((i) => i.dueDate < now);
    const totalOverdue = overdueInvoices.reduce((s, i) => s + Number(i.total), 0);
    const avgDaysToCollect = invoices.filter((i) => i.paidAt).length > 0
      ? Math.round(invoices.filter((i) => i.paidAt).reduce((s, i) =>
        s + (i.paidAt!.getTime() - i.issueDate.getTime()) / 86400000, 0) / invoices.filter((i) => i.paidAt).length)
      : 0;

    // ── Budget Adherence ────────────────────────────────
    const thisMonthExpenses = expenses.filter((e) => e.date >= thisMonthStart);
    let budgetsBroken = 0;
    const budgetsTotal = budgets.length;
    for (const b of budgets) {
      const spent = thisMonthExpenses
        .filter((e) => e.category?.name === b.category)
        .reduce((s, e) => s + Number(e.amount), 0);
      if (spent > Number(b.monthlyLimit)) budgetsBroken++;
    }

    // ── HEALTH SCORE (0-100) ────────────────────────────
    let score = 50; // Base

    // Profitability (+/- up to 20 pts)
    if (profitMargin > 20) score += 20;
    else if (profitMargin > 10) score += 15;
    else if (profitMargin > 0) score += 8;
    else if (profitMargin > -10) score -= 5;
    else score -= 15;

    // Revenue growth (+/- up to 15 pts)
    if (revenueGrowth > 15) score += 15;
    else if (revenueGrowth > 5) score += 10;
    else if (revenueGrowth > 0) score += 5;
    else if (revenueGrowth > -10) score -= 5;
    else score -= 10;

    // Cash runway (+/- up to 15 pts)
    if (runwayMonths >= 12) score += 15;
    else if (runwayMonths >= 6) score += 10;
    else if (runwayMonths >= 3) score += 5;
    else if (runwayMonths >= 1) score -= 5;
    else score -= 15;

    // AR health (+/- up to 10 pts)
    const overdueRatio = totalReceivables > 0 ? totalOverdue / totalReceivables : 0;
    if (overdueRatio < 0.1) score += 10;
    else if (overdueRatio < 0.25) score += 5;
    else if (overdueRatio < 0.5) score -= 5;
    else score -= 10;

    // Budget discipline (+/- up to 10 pts)
    if (budgetsTotal > 0) {
      const adherenceRate = 1 - budgetsBroken / budgetsTotal;
      score += Math.round(adherenceRate * 10);
    }

    score = Math.max(0, Math.min(100, score));

    // ── Grade ───────────────────────────────────────────
    let grade = "F";
    let gradeColor = "#EF4444";
    if (score >= 90) { grade = "A+"; gradeColor = "#22C55E"; }
    else if (score >= 80) { grade = "A"; gradeColor = "#22C55E"; }
    else if (score >= 70) { grade = "B+"; gradeColor = "#84CC16"; }
    else if (score >= 60) { grade = "B"; gradeColor = "#F59E0B"; }
    else if (score >= 50) { grade = "C"; gradeColor = "#F97316"; }
    else if (score >= 40) { grade = "D"; gradeColor = "#EF4444"; }

    // ── RECOMMENDATIONS ─────────────────────────────────
    const recommendations: Array<{
      priority: "critical" | "high" | "medium" | "low";
      category: string;
      title: string;
      description: string;
      impact: string;
      action: string;
    }> = [];

    // Profitability recs
    if (profitMargin < 0) {
      recommendations.push({
        priority: "critical",
        category: "Profitability",
        title: "Company is operating at a loss",
        description: `Net loss of ₹${Math.abs(netProfit).toLocaleString("en-IN")} this FY. Profit margin is ${profitMargin}%.`,
        impact: "Without correction, the company may run out of cash.",
        action: "Review top expense categories and identify 15-20% cost reduction opportunities. Consider renegotiating vendor contracts.",
      });
    } else if (profitMargin < 10) {
      recommendations.push({
        priority: "high",
        category: "Profitability",
        title: "Profit margins are thin",
        description: `Only ${profitMargin}% net margin. Healthy startups target 15-20%+.`,
        impact: "Low margins leave little buffer for unexpected expenses or market downturns.",
        action: "Focus on high-margin revenue streams and reduce discretionary spending.",
      });
    }

    // Revenue recs
    if (revenueGrowth < 0) {
      recommendations.push({
        priority: "critical",
        category: "Revenue",
        title: "Revenue is declining",
        description: `Revenue dropped ${Math.abs(revenueGrowth)}% vs previous quarter.`,
        impact: "Sustained revenue decline threatens business viability.",
        action: "Analyze client churn, review pricing strategy, and accelerate sales pipeline.",
      });
    } else if (revenueGrowth < 5 && totalRevenue > 0) {
      recommendations.push({
        priority: "medium",
        category: "Revenue",
        title: "Revenue growth is stagnant",
        description: `Only ${revenueGrowth}% growth. Target 10%+ quarterly for healthy scaling.`,
        impact: "Flat growth may not keep pace with inflation and rising costs.",
        action: "Invest in customer acquisition, upsell existing clients, or explore new revenue channels.",
      });
    }

    // Cash runway recs
    if (runwayMonths < 3 && runwayMonths !== Infinity) {
      recommendations.push({
        priority: "critical",
        category: "Cash Flow",
        title: `Only ${runwayMonths} month${runwayMonths === 1 ? "" : "s"} of runway left`,
        description: `Cash: ₹${totalCash.toLocaleString("en-IN")} vs monthly burn: ₹${avgMonthlyExpenses.toLocaleString("en-IN")}.`,
        impact: "Company may not be able to meet obligations.",
        action: "Urgently reduce non-essential spending. Accelerate collections. Consider bridge funding.",
      });
    } else if (runwayMonths < 6 && runwayMonths !== Infinity) {
      recommendations.push({
        priority: "high",
        category: "Cash Flow",
        title: "Cash runway is below 6 months",
        description: `${runwayMonths} months at current burn rate. Benchmark is 6-12 months.`,
        impact: "Limited time buffer reduces strategic flexibility.",
        action: "Build a 3-month cash reserve. Review recurring subscriptions.",
      });
    }

    // AR recs
    if (totalOverdue > 0) {
      recommendations.push({
        priority: overdueRatio > 0.3 ? "critical" : "high",
        category: "Receivables",
        title: `₹${totalOverdue.toLocaleString("en-IN")} in overdue invoices`,
        description: `${overdueInvoices.length} invoices past due. ${Math.round(overdueRatio * 100)}% of AR is overdue.`,
        impact: "Delays in collection worsen cash flow and increase bad debt risk.",
        action: "Send payment reminders for overdue invoices. Consider offering early payment discounts.",
      });
    }

    if (avgDaysToCollect > 45) {
      recommendations.push({
        priority: "medium",
        category: "Receivables",
        title: `Average collection period is ${avgDaysToCollect} days`,
        description: "Industry standard for services is 30-45 days.",
        impact: "Slow collections tie up working capital.",
        action: "Shorten payment terms to Net-15 or Net-30. Implement automated payment reminders.",
      });
    }

    // Expense concentration recs
    if (topCategories.length > 0 && topCategories[0].pct > 40) {
      recommendations.push({
        priority: "medium",
        category: "Expenses",
        title: `${topCategories[0].name} is ${topCategories[0].pct}% of total spend`,
        description: `High concentration in a single category (₹${topCategories[0].amount.toLocaleString("en-IN")}).`,
        impact: "Over-reliance on one cost center increases risk.",
        action: `Review ${topCategories[0].name} spending for optimization opportunities.`,
      });
    }

    // Budget recs
    if (budgetsBroken > 0) {
      recommendations.push({
        priority: "high",
        category: "Budgets",
        title: `${budgetsBroken} of ${budgetsTotal} budgets exceeded this month`,
        description: "Budget discipline is critical for financial health.",
        impact: "Consistently exceeding budgets leads to cash flow problems.",
        action: "Review exceeded budgets and either adjust limits or control spending.",
      });
    }

    // Tax recs
    const gstLiability = invoices
      .filter((i) => i.status === "paid")
      .reduce((s, i) => s + i.lineItems.reduce((ls, li) =>
        ls + Number(li.cgst) + Number(li.sgst) + Number(li.igst), 0), 0);

    if (gstLiability > 50000) {
      recommendations.push({
        priority: "medium",
        category: "Tax Planning",
        title: `₹${gstLiability.toLocaleString("en-IN")} GST liability — ensure ITC is maximized`,
        description: "Review input tax credits to reduce net GST payable.",
        impact: "Unclaimed ITC means overpaying taxes.",
        action: "Reconcile purchase invoices against GSTR-2A. Ensure all vendor invoices have valid GSTIN.",
      });
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return NextResponse.json({
      score,
      grade,
      gradeColor,
      financials: {
        totalRevenue,
        totalExpenses,
        netProfit,
        profitMargin,
        avgMonthlyRevenue: Math.round(avgMonthlyRevenue),
        avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
        revenueGrowth,
        totalCash,
        runwayMonths: runwayMonths === Infinity ? "∞" : runwayMonths,
        totalReceivables,
        totalOverdue,
        avgDaysToCollect,
      },
      topCategories,
      recommendations,
      dataPoints: {
        revenueMonths: Object.keys(monthlyRevenue).length,
        expenseRecords: expenses.length,
        invoiceCount: invoices.length,
        bankAccounts: bankAccounts.length,
      },
    });
  } catch (error) {
    log.error("Financial health analysis failed", { module: "health", action: "analyze", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
