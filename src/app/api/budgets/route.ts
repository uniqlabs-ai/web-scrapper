import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const BudgetSchema = z.object({
  category: z.string().min(1, "Category required").max(100),
  monthlyLimit: z.number().positive("Monthly limit must be positive"),
  alertAt: z.number().min(0).max(1).default(0.8),
});

/**
 * GET /api/budgets — List budget thresholds with actuals
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    if (!user?.organizationId) {
      return NextResponse.json({ budgets: [], summary: { totalBudget: 0, totalSpent: 0, variance: 0 } });
    }

    const budgets = await prisma.budgetThreshold.findMany({
      take: 500,
      where: { organizationId: user.organizationId },
      orderBy: { category: "asc" },
    });

    // Get current month's expenses grouped by category-like fields
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const expenses = await prisma.expense.findMany({
      take: 500,
      where: {
        userId,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      include: { category: true },
    });

    // Map expenses to categories
    const spentByCategory: Record<string, number> = {};
    for (const exp of expenses) {
      const catName = exp.category?.name || "Misc";
      spentByCategory[catName] = (spentByCategory[catName] || 0) + Number(exp.amount);
    }

    // Enrich budgets with actual spend
    const enriched = budgets.map((b) => {
      const spent = spentByCategory[b.category] || 0;
      const utilization = b.monthlyLimit ? (spent / Number(b.monthlyLimit)) * 100 : 0;
      const isOverBudget = utilization > 100;
      const isWarning = utilization >= Number(b.alertAt) * 100;

      return {
        id: b.id,
        category: b.category,
        monthlyLimit: Number(b.monthlyLimit),
        alertAt: Number(b.alertAt),
        spent,
        remaining: Math.max(Number(b.monthlyLimit) - spent, 0),
        utilization: Math.round(utilization),
        isOverBudget,
        isWarning,
      };
    });

    const totalBudget = enriched.reduce((acc, b) => acc + b.monthlyLimit, 0);
    const totalSpent = enriched.reduce((acc, b) => acc + b.spent, 0);

    return NextResponse.json({
      budgets: enriched,
      summary: {
        totalBudget,
        totalSpent,
        variance: totalBudget - totalSpent,
        utilizationPct: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
      },
      month: startOfMonth.toISOString(),
    });
  } catch (error) {
    log.error("Budgets error", { module: "budgets", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to fetch budgets" }, { status: 500 });
  }
}

/**
 * POST /api/budgets — Create or update a budget threshold
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "budgets" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = BudgetSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { category, monthlyLimit, alertAt } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    if (!user?.organizationId) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    // Upsert by category
    const existing = await prisma.budgetThreshold.findFirst({
      where: { organizationId: user.organizationId, category },
    });

    let budget;
    if (existing) {
      budget = await prisma.budgetThreshold.update({
        where: { id: existing.id },
        data: { monthlyLimit, alertAt: alertAt || 0.8 },
      });
    } else {
      budget = await prisma.budgetThreshold.create({
        data: {
          category,
          monthlyLimit,
          alertAt: alertAt || 0.8,
          organizationId: user.organizationId,
        },
      });
    }

    return NextResponse.json(budget, { status: 201 });
  } catch (error) {
    log.error("Create budget error", { module: "budgets", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to save budget" }, { status: 500 });
  }
}

/**
 * DELETE /api/budgets — Delete a budget threshold
 */
export async function DELETE(request: NextRequest) {
  try {
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const { organizationId, userId } = guard;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    // Verify budget belongs to this organization
    const budget = await prisma.budgetThreshold.findFirst({ where: { id, organizationId } });
    if (!budget) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    await prisma.budgetThreshold.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "budget", resourceId: id, details: { category: budget.category } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete budget error", { module: "budgets", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to delete budget" }, { status: 500 });
  }
}
