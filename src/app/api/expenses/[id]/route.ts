import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { UpdateExpenseSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 30, prefix: "expense-update" });
    if (limited) return limited;
    const { id } = await params;
    const guard = await requirePermission("write");
    if (!guard.allowed) return guard.response;
    const rawBody = await request.json();
    const parsed = UpdateExpenseSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        description: body.description,
        amount: body.amount,
        date: body.date ? new Date(body.date) : undefined,
        vendor: body.vendor,
        notes: body.notes,
        categoryId: body.categoryId,
      },
      include: { category: true },
    });

    return NextResponse.json({ expense });
  } catch (error) {
    log.error("Update expense error", { module: "expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to update expense" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, organizationId } = await requireTenant();
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const existing = await prisma.expense.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }
    await prisma.expense.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "expense", resourceId: id, details: { description: existing?.description } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    log.error("Delete expense error", { module: "expenses", action: "handler", error: toLogError(error) });
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2025") {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete expense" }, { status: 500 });
  }
}
