import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;

    const vendor = await prisma.vendor.findFirst({
      where: { id, userId },
    });

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    // Get all linked expenses with categories
    const expenses = await prisma.expense.findMany({
      take: 500,
      where: { userId, vendorId: id },
      include: { category: { select: { name: true, color: true } } },
      orderBy: { date: "desc" },
    });

    // Monthly spend aggregation
    const monthlyMap = new Map<string, number>();
    for (const e of expenses) {
      const m = new Date(e.date).toISOString().slice(0, 7); // YYYY-MM
      monthlyMap.set(m, (monthlyMap.get(m) || 0) + Number(e.amount));
    }
    const monthlySpend = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        amount,
      }));

    // Category breakdown
    const catMap = new Map<string, number>();
    for (const e of expenses) {
      const cat = e.category?.name || "Uncategorized";
      catMap.set(cat, (catMap.get(cat) || 0) + Number(e.amount));
    }
    const categoryBreakdown = [...catMap.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }));

    const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0);

    return NextResponse.json({
      vendor,
      totalSpent,
      txnCount: expenses.length,
      monthlySpend,
      categoryBreakdown,
      transactions: expenses.map((e) => ({
        date: e.date.toISOString(),
        description: e.description,
        amount: Number(e.amount),
        category: e.category?.name || null,
        categoryColor: e.category?.color || null,
      })),
    });
  } catch (error) {
    log.error("Vendor detail error", { module: "vendors", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load vendor details" }, { status: 500 });
  }
}
