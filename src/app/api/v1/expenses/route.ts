import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-auth";
import { fireWebhook } from "@/lib/webhooks";
import { log, toLogError } from "@/lib/logger";
import { V1CreateExpenseSchema } from "@/lib/schemas";

// GET /api/v1/expenses - Fetch expenses programmatically
export async function GET(req: NextRequest) {
  const organizationId = await validateApiKey(req);
  if (!organizationId) {
    return NextResponse.json({ error: "Unauthorized. Invalid or missing API Key" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const vendor = searchParams.get("vendor");
  
  const expenses = await prisma.expense.findMany({
      take: 500,
    where: {
      organizationId,
      ...(vendor ? { vendor } : {})
    },
    include: {
      category: {
        select: { id: true, name: true }
      }
    },
    orderBy: { date: 'desc' },
  });

  return NextResponse.json({ expenses });
}

// POST /api/v1/expenses - Push an expense programmatically originating from an external ERP/card provider
export async function POST(req: NextRequest) {
  const organizationId = await validateApiKey(req);
  if (!organizationId) {
    return NextResponse.json({ error: "Unauthorized. Invalid API Key" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = V1CreateExpenseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { description, amount, date, vendor, categoryId, receipt } = parsed.data;

    // Get an admin user for the relation requirement in this schema
    const admin = await prisma.user.findFirst({
      where: { organizationId, role: "admin" }
    });

    if (!admin) {
        return NextResponse.json({ error: "Organization has no active admin user" }, { status: 500 });
    }

    const expense = await prisma.expense.create({
      data: {
        description,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        vendor,
        categoryId,
        receipt,
        organizationId,
        userId: admin.id,
      },
    });

    // Notify external systems that listen to expense.created
    await fireWebhook(organizationId, "expense.created", expense);

    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    log.error("V1 Expense Create Error", { module: "expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
