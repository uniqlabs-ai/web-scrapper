import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const ApprovalSchema = z.object({
  expenseId: z.string().min(1, "expenseId required"),
  action: z.enum(["submit", "approve", "reject", "reimburse"]),
  notes: z.string().max(1000).optional(),
});

/**
 * GET /api/expenses/approvals — List expenses pending approval
 * POST /api/expenses/approvals — Submit, approve, reject, or reimburse
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "all"; // pending | approved | rejected | reimbursed

    const where: Record<string, unknown> = { userId, organizationId };
    if (status !== "all") {
      where.approvalStatus = status;
    }

    const expenses = await prisma.expense.findMany({
      take: 500,
      where,
      include: { category: true },
      orderBy: { date: "desc" },
    });

    const counts = {
      pending: expenses.filter((e) => (e as Record<string, unknown>).approvalStatus === "pending").length,
      approved: expenses.filter((e) => (e as Record<string, unknown>).approvalStatus === "approved").length,
      rejected: expenses.filter((e) => (e as Record<string, unknown>).approvalStatus === "rejected").length,
      reimbursed: expenses.filter((e) => (e as Record<string, unknown>).approvalStatus === "reimbursed").length,
    };

    return NextResponse.json({
      expenses: expenses.map((e) => ({
        id: e.id,
        description: e.description,
        amount: Number(e.amount),
        date: e.date.toISOString(),
        category: e.category?.name || "Uncategorized",
        vendor: e.vendor,
        receipt: e.receipt,
        approvalStatus: (e as Record<string, unknown>).approvalStatus || "pending",
      })),
      counts,
    });
  } catch (error) {
    log.error("Approvals error", { module: "expenses", action: "approvals", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 30, prefix: "expense-approval" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = ApprovalSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { expenseId, action, notes } = parsed.data;

    const statusMap: Record<string, string> = {
      submit: "pending",
      approve: "approved",
      reject: "rejected",
      reimburse: "reimbursed",
    };

    // We store approval status in the notes/source field for now
    // In production, you'd add approvalStatus to the Expense model
    const expense = await prisma.expense.update({
      where: { id: expenseId, userId, organizationId },
      data: {
        source: statusMap[action],
        notes: notes ? `${action}: ${notes}` : undefined,
      },
    });

    logAudit({ userId, action: "update", resource: "expense-approval", resourceId: expense.id, details: { approvalAction: action, newStatus: statusMap[action] } });
    return NextResponse.json({ success: true, status: statusMap[action], expenseId: expense.id });
  } catch (error) {
    log.error("Approval action error", { module: "expenses", action: "approvals", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
