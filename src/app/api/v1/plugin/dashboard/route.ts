import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRunway, getBurnRate, getRevenueData } from "@/lib/runway";
import { extractFounderOSToken } from "@/lib/founder-os-jwt";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

async function resolveIdentity(request: NextRequest): Promise<{ userId: string; organizationId: string }> {
  const token = extractFounderOSToken(request);
  if (token?.sub) {
    const orgId = token.organizationId;
    if (orgId) return { userId: token.sub, organizationId: orgId };
    const user = await prisma.user.findFirst({ where: { id: token.sub }, select: { organizationId: true } });
    return { userId: token.sub, organizationId: user?.organizationId || '' };
  }
  return await requireTenant();
}

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await resolveIdentity(request);

    const [runway, burnRate, revenue] = await Promise.all([
      getRunway(userId, organizationId),
      getBurnRate(userId, organizationId),
      getRevenueData(userId, organizationId),
    ]);

    const outstandingInvoices = await prisma.invoice.findMany({
      take: 50,
      where: { userId, organizationId, status: { in: ["sent", "overdue"] } },
    });

    const recentExpenses = await prisma.expense.findMany({
      take: 50,
      where: { userId, organizationId },
      orderBy: { createdAt: "desc" },
    });

    const recentActivity = [
      ...recentExpenses.map((e) => ({
        type: "expense.logged",
        summary: `Expense: ${e.description} — ₹${Number(e.amount).toLocaleString()}`,
        timestamp: e.createdAt.toISOString(),
      })),
    ];

    return NextResponse.json({
      productId: "finance",
      status: "healthy",
      kpis: {
        monthlyRevenue: `₹${revenue.currentMRR.toLocaleString()}`,
        burnRate: `₹${burnRate.currentMonth.toLocaleString()}/mo`,
        runwayMonths: runway.runwayMonths,
        outstandingInvoices: outstandingInvoices.length,
      },
      recentActivity: recentActivity.slice(0, 5),
    });
  } catch (error) {
    log.error("Plugin dashboard error", { module: "plugin", action: "dashboard", error: toLogError(error) });
    return NextResponse.json({
      productId: "finance",
      status: "error",
      kpis: {},
      recentActivity: [],
    });
  }
}
