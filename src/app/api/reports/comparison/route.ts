import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/reports/comparison — Period comparison (this vs last month/quarter/year)
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "month"; // month | quarter | year

    const now = new Date();
    let currentFrom: Date, currentTo: Date, previousFrom: Date, previousTo: Date;
    let currentLabel: string, previousLabel: string;

    if (period === "quarter") {
      const q = Math.floor(now.getMonth() / 3);
      currentFrom = new Date(now.getFullYear(), q * 3, 1);
      currentTo = new Date(now.getFullYear(), q * 3 + 3, 0);
      previousFrom = new Date(now.getFullYear(), (q - 1) * 3, 1);
      previousTo = new Date(now.getFullYear(), q * 3, 0);
      currentLabel = `Q${q + 1} ${now.getFullYear()}`;
      previousLabel = q > 0 ? `Q${q} ${now.getFullYear()}` : `Q4 ${now.getFullYear() - 1}`;
    } else if (period === "year") {
      currentFrom = new Date(now.getFullYear(), 0, 1);
      currentTo = now;
      previousFrom = new Date(now.getFullYear() - 1, 0, 1);
      previousTo = new Date(now.getFullYear() - 1, 11, 31);
      currentLabel = `${now.getFullYear()}`;
      previousLabel = `${now.getFullYear() - 1}`;
    } else {
      currentFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      currentTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      previousFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousTo = new Date(now.getFullYear(), now.getMonth(), 0);
      currentLabel = now.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
      previousLabel = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    }

    const [curRevenues, curExpenses, prevRevenues, prevExpenses] = await Promise.all([
      prisma.revenue.findMany({ where: { userId, organizationId, month: { gte: currentFrom, lte: currentTo } }, take: 10_000 }),
      prisma.expense.findMany({ where: { userId, organizationId, date: { gte: currentFrom, lte: currentTo } }, include: { category: true }, take: 10_000 }),
      prisma.revenue.findMany({ where: { userId, organizationId, month: { gte: previousFrom, lte: previousTo } }, take: 10_000 }),
      prisma.expense.findMany({ where: { userId, organizationId, date: { gte: previousFrom, lte: previousTo } }, include: { category: true }, take: 10_000 }),
    ]);

    const curRev = curRevenues.reduce((s, r) => s + Number(r.amount), 0);
    const prevRev = prevRevenues.reduce((s, r) => s + Number(r.amount), 0);
    const curExp = curExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const prevExp = prevExpenses.reduce((s, e) => s + Number(e.amount), 0);

    const pctChange = (cur: number, prev: number) => prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);

    // Category breakdown comparison
    const allCategories = new Set<string>();
    const curByCat: Record<string, number> = {};
    const prevByCat: Record<string, number> = {};

    for (const e of curExpenses) { const c = e.category?.name || "Uncategorized"; allCategories.add(c); curByCat[c] = (curByCat[c] || 0) + Number(e.amount); }
    for (const e of prevExpenses) { const c = e.category?.name || "Uncategorized"; allCategories.add(c); prevByCat[c] = (prevByCat[c] || 0) + Number(e.amount); }

    const categoryComparison = Array.from(allCategories).map((cat) => ({
      category: cat,
      current: curByCat[cat] || 0,
      previous: prevByCat[cat] || 0,
      change: pctChange(curByCat[cat] || 0, prevByCat[cat] || 0),
    })).sort((a, b) => b.current - a.current);

    return NextResponse.json({
      period,
      current: { label: currentLabel, revenue: curRev, expenses: curExp, profit: curRev - curExp, txnCount: curExpenses.length },
      previous: { label: previousLabel, revenue: prevRev, expenses: prevExp, profit: prevRev - prevExp, txnCount: prevExpenses.length },
      changes: {
        revenue: pctChange(curRev, prevRev),
        expenses: pctChange(curExp, prevExp),
        profit: pctChange(curRev - curExp, prevRev - prevExp),
      },
      categoryComparison,
    });
  } catch (error) {
    log.error("Comparison error", { module: "reports", action: "comparison", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
