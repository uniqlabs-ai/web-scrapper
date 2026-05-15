import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/reports/aging — Accounts Receivable & Payable aging
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "receivable"; // receivable | payable

    const now = new Date();

    if (type === "receivable") {
      // Invoices that are sent or overdue (money owed TO us)
      const invoices = await prisma.invoice.findMany({
      take: 10000,
        where: {
          userId,
          organizationId,
          status: { in: ["sent", "overdue", "partial"] },
        },
        include: {
          client: { select: { name: true, company: true } },
          payments: true,
        },
        orderBy: { dueDate: "asc" },
      });

      const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
      const items = invoices.map((inv) => {
        const totalPaid = inv.payments.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
        const balance = Number(inv.total) - totalPaid;
        const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);

        if (daysOverdue <= 0) buckets.current += balance;
        else if (daysOverdue <= 30) buckets.d1_30 += balance;
        else if (daysOverdue <= 60) buckets.d31_60 += balance;
        else if (daysOverdue <= 90) buckets.d61_90 += balance;
        else buckets.d90_plus += balance;

        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          clientName: inv.client?.name || "Unknown",
          issueDate: inv.issueDate.toISOString(),
          dueDate: inv.dueDate.toISOString(),
          total: Number(inv.total),
          paid: totalPaid,
          balance,
          daysOverdue: Math.max(daysOverdue, 0),
          status: inv.status,
        };
      });

      const totalOutstanding = items.reduce((sum, i) => sum + i.balance, 0);

      return NextResponse.json({
        type: "receivable",
        buckets,
        totalOutstanding,
        invoiceCount: items.length,
        items,
      });
    } else {
      // Payable: expenses without receipts or unreconciled (simplified)
      // In a full system this would track vendor bills
      const recentExpenses = await prisma.expense.findMany({
      take: 10000,
        where: { userId, organizationId, date: { gte: new Date(now.getTime() - 90 * 86400000) } },
        include: { category: true },
        orderBy: { date: "desc" },
      });

      const totalPayable = recentExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

      return NextResponse.json({
        type: "payable",
        totalPayable,
        expenseCount: recentExpenses.length,
        items: recentExpenses.map((e) => ({
          id: e.id,
          description: e.description,
          amount: Number(e.amount),
          date: e.date.toISOString(),
          vendor: e.vendor,
          category: e.category?.name,
        })),
      });
    }
  } catch (error) {
    log.error("Aging report error", { module: "reports", action: "aging", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to generate aging report" }, { status: 500 });
  }
}
