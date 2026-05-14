import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const RecurringExpenseSchema = z.object({
  description: z.string().min(1, "Description required").max(500),
  amount: z.number().positive("Amount must be positive"),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "annual"]).default("monthly"),
  startDate: z.string().optional(),
  vendor: z.string().max(200).optional(),
  categoryId: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * GET /api/recurring-expenses — List recurring expenses
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    const recurring = await prisma.recurringExpense.findMany({
      take: 500,
      where: { userId },
      orderBy: { nextDueDate: "asc" },
    });

    // Filter out items whose description is an alias of another item
    const aliasToOwnerId = new Map<string, string>();
    for (const r of recurring) {
      try {
        const parsed = JSON.parse(r.aliases || "[]");
        if (Array.isArray(parsed)) {
          for (const alias of parsed) {
            aliasToOwnerId.set(String(alias).toLowerCase(), r.id);
          }
        }
      } catch (e: unknown) {
        // RELIABILITY: Log malformed alias JSON instead of silently swallowing
        log.warn("Malformed aliases JSON", { module: "recurring-expenses", action: "list", meta: { id: r.id, error: e instanceof Error ? e.message : String(e) } });
      }
    }
    const filtered = recurring.filter(r => {
      const owner = aliasToOwnerId.get(r.description.toLowerCase());
      return !owner || owner === r.id;
    });

    return NextResponse.json({
      recurringExpenses: filtered.map((r) => ({
        id: r.id,
        description: r.description,
        amount: Number(r.amount),
        frequency: r.frequency,
        nextDueDate: r.nextDueDate.toISOString(),
        lastCreated: r.lastCreated?.toISOString() || null,
        isActive: r.isActive,
        vendor: r.vendor,
        categoryId: r.categoryId,
        notes: r.notes,
      })),
    });
  } catch (error) {
    log.error("List recurring error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to fetch recurring expenses" }, { status: 500 });
  }
}

/**
 * POST /api/recurring-expenses — Create a recurring expense
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 10, prefix: "recurring" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = RecurringExpenseSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { description, amount, frequency, startDate, vendor, categoryId, notes } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    // Calculate next due date based on frequency
    const start = startDate ? new Date(startDate) : new Date();
    const nextDueDate = new Date(start);

    // If start is in the past, fast-forward to next occurrence
    const now = new Date();
    while (nextDueDate < now) {
      switch (frequency || "monthly") {
        case "weekly":
          nextDueDate.setDate(nextDueDate.getDate() + 7);
          break;
        case "monthly":
          nextDueDate.setMonth(nextDueDate.getMonth() + 1);
          break;
        case "quarterly":
          nextDueDate.setMonth(nextDueDate.getMonth() + 3);
          break;
        case "yearly":
          nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
          break;
      }
    }

    const re = await prisma.recurringExpense.create({
      data: {
        description,
        amount,
        frequency: frequency || "monthly",
        startDate: start,
        nextDueDate,
        vendor,
        categoryId,
        notes,
        userId,
        organizationId,
      },
    });

    return NextResponse.json(re, { status: 201 });
  } catch (error) {
    log.error("Create recurring error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create recurring expense" }, { status: 500 });
  }
}

/**
 * PUT /api/recurring-expenses — Toggle active state (resume/pause)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    const updated = await prisma.recurringExpense.update({
      where: { id },
      data: { isActive: isActive !== false },
    });

    return NextResponse.json({ success: true, isActive: updated.isActive });
  } catch (error) {
    log.error("Toggle recurring error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to toggle" }, { status: 500 });
  }
}

/**
 * DELETE /api/recurring-expenses — Delete/deactivate a recurring expense
 */
export async function DELETE(request: NextRequest) {
  try {
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const { userId, organizationId } = guard;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    // Verify ownership before soft-delete
    const existing = await prisma.recurringExpense.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });
    }

    // Soft-delete: deactivate instead of hard delete
    await prisma.recurringExpense.update({
      where: { id },
      data: { isActive: false },
    });

    logAudit({ userId, action: "delete", resource: "recurring_expense", resourceId: id, details: { description: existing.description } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete recurring error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to deactivate" }, { status: 500 });
  }
}

/**
 * PATCH /api/recurring-expenses — Process due recurring expenses (creates actual expenses)
 * Called periodically or on page load
 */
export async function PATCH() {
  try {
    const { userId, organizationId } = await requireTenant();
    const now = new Date();

    const due = await prisma.recurringExpense.findMany({
      take: 500,
      where: {
        userId,
        isActive: true,
        nextDueDate: { lte: now },
      },
    });

    let created = 0;

    for (const re of due) {
      // Create the expense
      await prisma.expense.create({
        data: {
          description: `${re.description} (auto)`,
          amount: re.amount,
          date: re.nextDueDate,
          vendor: re.vendor,
          isRecurring: true,
          source: "recurring",
          sourceId: re.id,
          categoryId: re.categoryId,
          userId: re.userId,
          organizationId: re.organizationId,
        },
      });

      // Advance nextDueDate
      const next = new Date(re.nextDueDate);
      switch (re.frequency) {
        case "weekly":
          next.setDate(next.getDate() + 7);
          break;
        case "monthly":
          next.setMonth(next.getMonth() + 1);
          break;
        case "quarterly":
          next.setMonth(next.getMonth() + 3);
          break;
        case "yearly":
          next.setFullYear(next.getFullYear() + 1);
          break;
      }

      // Check if past endDate
      const isStillActive = !re.endDate || next <= re.endDate;

      await prisma.recurringExpense.update({
        where: { id: re.id },
        data: {
          lastCreated: re.nextDueDate,
          nextDueDate: next,
          isActive: isStillActive,
        },
      });

      created++;
    }

    return NextResponse.json({ processed: created, message: `${created} expenses created` });
  } catch (error) {
    log.error("Process recurring error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to process recurring" }, { status: 500 });
  }
}
