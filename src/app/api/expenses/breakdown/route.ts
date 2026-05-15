import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/expenses/breakdown — Category breakdown for expenses
 * Returns aggregated data for pie/donut charts.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();

    const url = new URL(request.url);
    const months = parseInt(url.searchParams.get("months") || "12");
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    // Get all expenses with categories
    const expenses = await prisma.expense.findMany({
      take: 500,
      where: { userId, date: { gte: since } },
      include: { category: true },
      orderBy: { date: "desc" },
    });

    // Aggregate by category
    const byCategoryMap: Record<string, { total: number; count: number; color: string }> = {};
    const byVendorMap: Record<string, { total: number; count: number; category: string }> = {};

    for (const exp of expenses) {
      const catName = exp.category?.name || "Uncategorized";
      const catColor = exp.category?.color || "#9CA3AF";
      if (!byCategoryMap[catName]) byCategoryMap[catName] = { total: 0, count: 0, color: catColor };
      byCategoryMap[catName].total += Number(exp.amount);
      byCategoryMap[catName].count++;

      const vendorName = exp.vendor || "Unknown";
      if (!byVendorMap[vendorName]) byVendorMap[vendorName] = { total: 0, count: 0, category: catName };
      byVendorMap[vendorName].total += Number(exp.amount);
      byVendorMap[vendorName].count++;
    }

    // Sort categories by total (descending)
    const byCategory = Object.entries(byCategoryMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);

    // Sort vendors by total (top 20)
    const byVendor = Object.entries(byVendorMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    // Monthly trend by category
    const monthlyTrend: Record<string, Record<string, number>> = {};
    for (const exp of expenses) {
      const monthKey = `${exp.date.getFullYear()}-${String(exp.date.getMonth() + 1).padStart(2, "0")}`;
      const catName = exp.category?.name || "Uncategorized";
      if (!monthlyTrend[monthKey]) monthlyTrend[monthKey] = {};
      monthlyTrend[monthKey][catName] = (monthlyTrend[monthKey][catName] || 0) + Number(exp.amount);
    }

    const grandTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);

    return NextResponse.json({
      byCategory,
      byVendor,
      monthlyTrend: Object.entries(monthlyTrend)
        .map(([month, cats]) => ({ month, ...cats }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      grandTotal,
      count: expenses.length,
    });
  } catch (error) {
    log.error("Expense breakdown error", { module: "expenses", action: "breakdown", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load breakdown" }, { status: 500 });
  }
}
