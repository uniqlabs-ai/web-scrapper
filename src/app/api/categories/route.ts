import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { CreateCategorySchema } from "@/lib/schemas";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/categories — List expense categories
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const categories = await prisma.expenseCategory.findMany({
      where: { organizationId, userId },
      orderBy: { name: "asc" },
      include: { _count: { select: { expenses: true } } },
      take: 500, // RELIABILITY: Query boundary
    });
    return NextResponse.json(categories);
  } catch (error) {
    log.error("Categories error", { module: "categories", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/categories — Create a category
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "categories" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const raw = await request.json();
    const result = CreateCategorySchema.safeParse(raw);

    if (!result.success) {
      return NextResponse.json({ error: "Invalid payload", details: result.error.issues }, { status: 400 });
    }

    const category = await prisma.expenseCategory.create({
      data: {
        name: result.data.name,
        icon: result.data.icon || null,
        color: result.data.color || null,
        userId,
        organizationId,
      },
    });

    return NextResponse.json(category, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Category already exists" },
        { status: 409 }
      );
    }
    log.error("Create category error", { module: "categories", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to create category" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/categories — Delete a category by ID (query param)
 */
export async function DELETE(request: NextRequest) {
  try {
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const { userId, organizationId } = guard;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const category = await prisma.expenseCategory.findFirst({ where: { id, organizationId } });
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    await prisma.expenseCategory.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "category", resourceId: id, details: { name: category.name } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete category error", { module: "categories", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to delete category" },
      { status: 500 }
    );
  }
}
