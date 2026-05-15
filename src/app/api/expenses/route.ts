import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { log, toLogError } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

const NextExpenseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.number().min(0, "Amount must be positive"),
  date: z.string().optional(),
  vendor: z.string().optional(),
  notes: z.string().optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  isRecurring: z.boolean().default(false)
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const { userId, organizationId } = await requireTenant();
    const where: Record<string, unknown> = { organizationId, userId };
    if (categoryId) where.categoryId = categoryId;
    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, unknown>).gte = new Date(from);
      if (to) (where.date as Record<string, unknown>).lte = new Date(to);
    }

    const expenses = await prisma.expense.findMany({
      take: 500, // RELIABILITY: Query boundary — prevents OOM on large datasets
      where,
      include: { category: true, account: true },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({ expenses });
  } catch (error) {
    log.error("List expenses error", { module: "expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to list expenses" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "expenses" });
    if (limited) return limited;
    const rawBody = await request.json();
    const result = NextExpenseSchema.safeParse(rawBody);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: result.error.issues },
        { status: 400 }
      );
    }

    const { description, amount, date, vendor, notes, categoryId, accountId, isRecurring } = result.data;

    // RELIABILITY: Atomic transaction — expense creation + balance decrement must succeed or fail together
    const expense = await prisma.$transaction(async (tx) => {
      const { userId, organizationId } = await requireTenant();

      const exp = await tx.expense.create({
        data: {
          userId,
          organizationId,
          description,
          amount,
          date: date ? new Date(date) : new Date(),
          vendor,
          notes,
          categoryId: categoryId || undefined,
          accountId: accountId || undefined,
          isRecurring: isRecurring || false,
        },
        include: { category: true },
      });

      if (accountId) {
        await tx.account.update({
          where: { id: accountId },
          data: { currentBalance: { decrement: amount } },
        });
      }

      return exp;
    });

    logAudit({ userId: expense.userId, action: "create", resource: "expense", resourceId: expense.id, details: { description: expense.description, amount: expense.amount } });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    log.error("Create expense error", { module: "expenses", action: "create", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
