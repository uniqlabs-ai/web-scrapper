import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { UpdateRecurringExpenseSchema } from "@/lib/schemas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;

    const item = await prisma.recurringExpense.findFirst({
      where: { id, userId },
    });

    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Match bank transactions by description (and aliases)
    const searchTerms: string[] = [item.description];
    try {
      const aliases = JSON.parse(item.aliases || "[]");
      if (Array.isArray(aliases)) searchTerms.push(...aliases);
    } catch (e: unknown) {
      // RELIABILITY: Log malformed alias JSON
      log.warn("Malformed aliases JSON", { module: "recurring-expenses", action: "detail", meta: { id, error: e instanceof Error ? e.message : String(e) } });
    }

    const orConditions = searchTerms.map(term => ({
      description: { contains: term, mode: "insensitive" as const },
    }));

    const bankTxns = await prisma.bankTransaction.findMany({
      take: 500,
      where: {
        userId,
        type: "debit",
        OR: orConditions,
      },
      orderBy: { date: "desc" },
      select: { date: true, description: true, amount: true },
    });

    // Monthly aggregation
    const monthlyMap = new Map<string, number>();
    for (const t of bankTxns) {
      const m = t.date.toISOString().slice(0, 7);
      monthlyMap.set(m, (monthlyMap.get(m) || 0) + Number(t.amount));
    }
    const monthlySpend = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        amount,
      }));

    const totalSpent = bankTxns.reduce((s, t) => s + Number(t.amount), 0);

    return NextResponse.json({
      item: {
        ...item,
        amount: Number(item.amount),
      },
      matchedTransactions: bankTxns.map(t => {
        const desc = t.description.toLowerCase();
        const primaryDesc = item.description.toLowerCase();
        const parsedAliases: string[] = [];
        try { const a = JSON.parse(item.aliases || "[]"); if (Array.isArray(a)) parsedAliases.push(...a); } catch (e: unknown) {
          log.warn("Malformed aliases JSON", { module: "recurring-expenses", action: "detail", meta: { error: e instanceof Error ? e.message : String(e) } });
        }
        
        let matchedVia: string | null = null;
        const matchingAlias = parsedAliases.find(alias => desc.includes(alias.toLowerCase()));
        const matchesPrimary = desc.includes(primaryDesc);
        
        if (matchingAlias && matchesPrimary) {
          if (matchingAlias.length > item.description.length) {
            matchedVia = matchingAlias;
          }
        } else if (matchingAlias && !matchesPrimary) {
          matchedVia = matchingAlias;
        }
        
        return {
          date: t.date.toISOString(),
          description: t.description,
          amount: Number(t.amount),
          matchedVia,
        };
      }),
      monthlySpend,
      totalSpent,
      txnCount: bankTxns.length,
    });
  } catch (error) {
    log.error("Recurring detail error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load details" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;
    const rawBody = await request.json();

    const parsed = UpdateRecurringExpenseSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data as Record<string, unknown>;

    const existing = await prisma.recurringExpense.findFirst({ where: { id, userId } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const allowedFields = ["description", "amount", "currency", "frequency", "vendor", "notes", "aliases", "bucketName", "isActive", "categoryId"];
    const updateData: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        if (key === "amount") {
          updateData[key] = Number(body[key]) || 0;
        } else {
          updateData[key] = body[key];
        }
      }
    }

    const updated = await prisma.recurringExpense.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(updated);
  } catch (error) {
    log.error("Update recurring error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;
    const existing = await prisma.recurringExpense.findFirst({ where: { id, userId } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.recurringExpense.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "recurring", resourceId: id, details: { description: existing.description } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete recurring error", { module: "recurring-expenses", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
