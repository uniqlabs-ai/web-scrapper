import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRunway, getBurnRate, getRevenueData } from "@/lib/runway";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    const [runway, burnRate, revenue] = await Promise.all([
      getRunway(userId, organizationId),
      getBurnRate(userId, organizationId),
      getRevenueData(userId, organizationId),
    ]);

    const outstandingInvoices = await prisma.invoice.findMany({
      take: 50,
      where: {
        organizationId,
        status: { in: ["sent", "overdue"] },
      },
    });

    const outstandingTotal = outstandingInvoices.reduce(
      (sum, inv) => sum + Number(inv.total),
      0
    );

    const thisMonthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );
    const thisMonthExpenses = await prisma.expense.aggregate({
      where: { organizationId, date: { gte: thisMonthStart } },
      _sum: { amount: true },
    });

    return NextResponse.json({
      monthlyRevenue: revenue.totalMonthlyRevenue,
      totalMonthlyRevenue: revenue.totalMonthlyRevenue,
      burnRate: burnRate.currentMonth,
      runwayMonths: runway.runwayMonths,
      outstandingInvoices: {
        count: outstandingInvoices.length,
        total: outstandingTotal,
      },
      totalExpensesThisMonth: Number(thisMonthExpenses._sum.amount ?? 0),
      revenueGrowth: revenue.growth,
      runway,
      burnRateDetails: burnRate,
      revenueDetails: revenue,
    });
  } catch (error) {
    log.error("Dashboard error", { module: "dashboard", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
