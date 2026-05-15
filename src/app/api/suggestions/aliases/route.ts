import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const AliasQuerySchema = z.object({
  type: z.enum(["vendor", "payroll", "client", "recurring", "all"]).default("all"),
  q: z.string().max(200).default(""),
});

/**
 * GET /api/suggestions/aliases?type=vendor|payroll|client|recurring&q=search
 *
 * Returns distinct bank transaction descriptions, vendor names, employee names,
 * recurring descriptions, etc. for smart alias suggestions.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const parsed = AliasQuerySchema.safeParse({
      type: searchParams.get("type") || undefined,
      q: searchParams.get("q") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { type, q } = parsed.data;

    const suggestions: { label: string; source: string }[] = [];

    // 1. Bank transaction descriptions (always include — primary source)
    const bankTxns = await prisma.bankTransaction.findMany({
      take: 500,
      where: {
        userId,
        ...(q ? { description: { contains: q, mode: "insensitive" } } : {}),
      },
      select: { description: true },
      distinct: ["description"],
      orderBy: { date: "desc" },
    });

    // Deduplicate and extract meaningful names
    const seenDescriptions = new Set<string>();
    for (const txn of bankTxns) {
      const desc = txn.description?.trim();
      if (!desc || seenDescriptions.has(desc.toLowerCase())) continue;
      seenDescriptions.add(desc.toLowerCase());
      suggestions.push({ label: desc, source: "bank" });
    }

    // 2. Existing entity names based on type
    if (type === "vendor" || type === "all") {
      const vendors = await prisma.vendor.findMany({
      take: 500,
        where: { userId, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
        select: { name: true },
      });
      for (const v of vendors) {
        if (!seenDescriptions.has(v.name.toLowerCase())) {
          suggestions.push({ label: v.name, source: "vendor" });
          seenDescriptions.add(v.name.toLowerCase());
        }
      }
    }

    if (type === "payroll" || type === "all") {
      const employees = await prisma.employee.findMany({
      take: 500,
        where: { userId, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
        select: { name: true },
      });
      for (const e of employees) {
        if (!seenDescriptions.has(e.name.toLowerCase())) {
          suggestions.push({ label: e.name, source: "payroll" });
          seenDescriptions.add(e.name.toLowerCase());
        }
      }
    }

    if (type === "client" || type === "all") {
      const clients = await prisma.client.findMany({
      take: 500,
        where: { userId, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
        select: { name: true },
      });
      for (const c of clients) {
        if (!seenDescriptions.has(c.name.toLowerCase())) {
          suggestions.push({ label: c.name, source: "client" });
          seenDescriptions.add(c.name.toLowerCase());
        }
      }
    }

    if (type === "recurring" || type === "all") {
      const recurring = await prisma.recurringExpense.findMany({
      take: 500,
        where: { userId, ...(q ? { description: { contains: q, mode: "insensitive" } } : {}) },
        select: { description: true },
      });
      for (const r of recurring) {
        if (!seenDescriptions.has(r.description.toLowerCase())) {
          suggestions.push({ label: r.description, source: "recurring" });
          seenDescriptions.add(r.description.toLowerCase());
        }
      }
    }

    // 3. Expense descriptions
    const expenses = await prisma.expense.findMany({
      take: 500,
      where: {
        userId,
        ...(q ? { description: { contains: q, mode: "insensitive" } } : {}),
      },
      select: { description: true },
      distinct: ["description"],
    });
    for (const e of expenses) {
      const desc = e.description?.trim();
      if (!desc || seenDescriptions.has(desc.toLowerCase())) continue;
      seenDescriptions.add(desc.toLowerCase());
      suggestions.push({ label: desc, source: "expense" });
    }

    // Sort: entity-specific sources first, then bank, then expense; alphabetically within each
    const sourceOrder: Record<string, number> = { vendor: 0, payroll: 0, client: 0, recurring: 0, bank: 1, expense: 2 };
    suggestions.sort((a, b) => {
      const sa = sourceOrder[a.source] ?? 3;
      const sb = sourceOrder[b.source] ?? 3;
      return sa !== sb ? sa - sb : a.label.localeCompare(b.label);
    });

    return NextResponse.json({
      suggestions: suggestions.slice(0, 100),
    });
  } catch (error) {
    log.error("Alias suggestions error", { module: "suggestions", action: "aliases", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
