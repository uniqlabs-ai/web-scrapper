import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const UpdateEmployeeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  designation: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  basicSalary: z.coerce.number().min(0).optional(),
  hra: z.coerce.number().min(0).optional(),
  da: z.coerce.number().min(0).optional(),
  specialAllowance: z.coerce.number().min(0).optional(),
  otherAllowance: z.coerce.number().min(0).optional(),
  ctc: z.coerce.number().min(0).optional(),
  type: z.enum(["employee", "contractor"]).optional(),
  paymentBasis: z.enum(["fixed", "milestone", "hourly"]).optional(),
  aliases: z.string().max(5000).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;

    const employee = await prisma.employee.findFirst({
      where: { id, userId, organizationId },
    });

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Match bank transactions by name AND aliases
    const searchTerms: string[] = [employee.name];
    try {
      const aliases = JSON.parse(employee.aliases || "[]");
      if (Array.isArray(aliases)) searchTerms.push(...aliases);
    } catch (e: unknown) {
      // RELIABILITY: Log malformed alias JSON
      log.warn("Malformed aliases JSON", { module: "payroll", action: "detail", meta: { employeeId: id, error: e instanceof Error ? e.message : String(e) } });
    }

    const orConditions = searchTerms.map(term => ({
      description: { contains: term, mode: "insensitive" as const },
    }));

    const expenses = await prisma.expense.findMany({
      take: 500,
      where: {
        userId,
        organizationId,
        OR: orConditions,
      },
      include: { category: { select: { name: true, color: true } } },
      orderBy: { date: "desc" },
    });

    // Monthly payments
    const monthlyMap = new Map<string, number>();
    for (const e of expenses) {
      const m = new Date(e.date).toISOString().slice(0, 7);
      monthlyMap.set(m, (monthlyMap.get(m) || 0) + Number(e.amount));
    }
    const monthlyPayments = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        amount,
      }));

    const totalPaid = expenses.reduce((s, e) => s + Number(e.amount), 0);

    // Consistency check
    const amounts = expenses.map(e => Number(e.amount));
    const avg = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
    const variance = amounts.length > 1
      ? amounts.reduce((s, a) => s + Math.pow(a - avg, 2), 0) / amounts.length
      : 0;
    const isConsistent = avg > 0 ? Math.sqrt(variance) / avg < 0.1 : false;

    return NextResponse.json({
      employee,
      totalPaid,
      txnCount: expenses.length,
      monthlyPayments,
      avgPayment: avg,
      isConsistent,
      transactions: expenses.map((e) => {
        const desc = e.description.toLowerCase();
        const primaryName = employee.name.toLowerCase();
        const parsedAliases: string[] = [];
        try { const a = JSON.parse(employee.aliases || "[]"); if (Array.isArray(a)) parsedAliases.push(...a); } catch (e: unknown) {
          log.warn("Malformed aliases JSON", { module: "payroll", action: "detail", meta: { error: e instanceof Error ? e.message : String(e) } });
        }
        
        // Find which term matched best (check aliases first since they may be more specific)
        let matchedVia: string | null = null;
        const matchingAlias = parsedAliases.find(alias => desc.includes(alias.toLowerCase()));
        const matchesPrimary = desc.includes(primaryName);
        
        if (matchingAlias && matchesPrimary) {
          // Both match — if alias is longer/more specific, tag as alias match
          if (matchingAlias.length > employee.name.length) {
            matchedVia = matchingAlias;
          }
        } else if (matchingAlias && !matchesPrimary) {
          matchedVia = matchingAlias;
        }
        
        return {
          date: e.date.toISOString(),
          description: e.description,
          amount: Number(e.amount),
          category: e.category?.name || null,
          categoryColor: e.category?.color || null,
          matchedVia,
        };
      }),
    });
  } catch (error) {
    log.error("Payroll detail error", { module: "payroll", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load employee details" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 15, prefix: "payroll-update" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const guard = await requirePermission("write");
    if (!guard.allowed) return guard.response;
    const { id } = await params;
    const rawBody = await request.json();

    const parsed = UpdateEmployeeSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data as Record<string, unknown>;

    const existing = await prisma.employee.findFirst({ where: { id, userId, organizationId } });
    if (!existing) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const allowedFields = ["name", "email", "phone", "designation", "department", "basicSalary", "hra", "da", "specialAllowance", "otherAllowance", "ctc", "type", "paymentBasis", "aliases", "isActive"];
    const updateData: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        if (["basicSalary", "hra", "da", "specialAllowance", "otherAllowance", "ctc"].includes(key)) {
          updateData[key] = Number(body[key]) || 0;
        } else {
          updateData[key] = body[key];
        }
      }
    }

    const updated = await prisma.employee.update({
      where: { id, userId, organizationId },
      data: updateData,
    });
    return NextResponse.json(updated);
  } catch (error) {
    log.error("Update employee error", { module: "payroll", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const { id } = await params;
    const existing = await prisma.employee.findFirst({ where: { id, userId, organizationId } });
    if (!existing) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    await prisma.employee.delete({ where: { id, userId, organizationId } });
    logAudit({ userId, action: "delete", resource: "employee", resourceId: id, details: { name: existing.name } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete employee error", { module: "payroll", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to delete employee" }, { status: 500 });
  }
}
