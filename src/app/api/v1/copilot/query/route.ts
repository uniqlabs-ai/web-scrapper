import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractFounderOSToken } from "@/lib/founder-os-jwt";
import { getRunway, getBurnRate, getRevenueData } from "@/lib/runway";
import { generatePnL, projectCashFlow } from "@/lib/financial-intelligence";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { CopilotQuerySchema } from "@/lib/schemas";

/**
 * POST /api/v1/copilot/query
 *
 * Structured data query endpoint called by Founder OS orchestrator.
 * Supported queries (declared in plugin manifest):
 *   - getRunway
 *   - getExpenses
 *   - getInvoices
 *   - getCashFlowProjection
 *   - getCostByDepartment
 *   - getFinancialHealth
 *   - getRevenueByClient
 *
 * Supported actions:
 *   - createInvoice
 *   - logExpense
 */

async function resolveIdentity(request: NextRequest, orgId?: string): Promise<{ userId: string; organizationId: string }> {
  // Founder OS JWT takes priority (cross-product calls)
  const token = extractFounderOSToken(request);
  if (token?.sub) {
    // For cross-product calls, resolve organizationId from token or user record
    const orgIdResolved = token.organizationId || orgId;
    if (orgIdResolved) return { userId: token.sub, organizationId: orgIdResolved };
    // Fallback: look up user's org
    const user = await prisma.user.findFirst({ where: { id: token.sub }, select: { organizationId: true } });
    return { userId: token.sub, organizationId: user?.organizationId || '' };
  }
  // Explicit orgId from request body
  if (orgId) {
    const user = await requireTenant();
    return { userId: user.userId, organizationId: orgId };
  }
  // Session auth
  return await requireTenant();
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();

    const parsed = CopilotQuerySchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;
    const { orgId, query, params } = body;

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const { userId, organizationId } = await resolveIdentity(request, orgId);

    switch (query) {
      // ── QUERIES ──────────────────────────────────────────

      case "getRunway": {
        const [runway, burnRate, revenue] = await Promise.all([
          getRunway(userId, organizationId),
          getBurnRate(userId, organizationId),
          getRevenueData(userId, organizationId),
        ]);

        const unpaidInvoices = await prisma.invoice.findMany({
      take: 200,
          where: { userId, organizationId, status: { in: ["sent", "overdue"] } },
          select: { id: true, invoiceNumber: true, total: true, dueDate: true, status: true },
        });

        return NextResponse.json({
          success: true,
          data: {
            runway,
            burnRate,
            mrr: revenue.currentMRR,
            arr: revenue.currentARR,
            unpaidInvoices,
          },
        });
      }

      case "getExpenses": {
        const where: Record<string, unknown> = { userId, organizationId };
        if (params?.category) where.categoryId = params.category;
        if (params?.from || params?.to) {
          where.date = {};
          if (params.from) (where.date as Record<string, unknown>).gte = new Date(params.from);
          if (params.to) (where.date as Record<string, unknown>).lte = new Date(params.to);
        }

        const expenses = await prisma.expense.findMany({
      take: 200,
          where,
          include: { category: true },
          orderBy: { date: "desc" },
        });

        const thisMonth = new Date();
        thisMonth.setDate(1);
        const thisMonthExpenses = expenses
          .filter((e) => e.date >= thisMonth)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

        return NextResponse.json({
          success: true,
          data: {
            expenses,
            summary: { thisMonth: thisMonthExpenses, total, count: expenses.length },
          },
        });
      }

      case "getInvoices": {
        const invWhere: Record<string, unknown> = { userId, organizationId };
        if (params?.status) invWhere.status = params.status;

        const invoices = await prisma.invoice.findMany({
      take: 200,
          where: invWhere,
          include: { client: true, lineItems: true },
          orderBy: { createdAt: "desc" },
        });

        const outstanding = invoices.filter((i) => ["sent", "overdue"].includes(i.status));

        return NextResponse.json({
          success: true,
          data: {
            invoices,
            summary: {
              total: invoices.length,
              outstanding: outstanding.length,
              outstandingAmount: outstanding.reduce((s, i) => s + Number(i.total), 0),
            },
          },
        });
      }

      case "getCashFlowProjection": {
        const months = Math.min(params?.months || 6, 24);
        const projection = await projectCashFlow(userId, organizationId, months);
        return NextResponse.json({ success: true, data: projection });
      }

      case "getCostByDepartment": {
        const now = new Date();
        const from = params?.from
          ? new Date(params.from)
          : new Date(now.getFullYear(), now.getMonth(), 1);
        const to = params?.to
          ? new Date(params.to)
          : new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const deptExpenses = await prisma.expense.findMany({
      take: 200,
          where: { userId, organizationId, date: { gte: from, lte: to } },
          include: { category: true },
        });

        const byDepartment = new Map<string, { total: number; count: number }>();
        for (const e of deptExpenses) {
          const dept = e.department || "Uncategorized";
          const existing = byDepartment.get(dept) || { total: 0, count: 0 };
          byDepartment.set(dept, {
            total: existing.total + Number(e.amount),
            count: existing.count + 1,
          });
        }

        const departments = Array.from(byDepartment.entries())
          .map(([department, data]) => ({
            department,
            total: Math.round(data.total * 100) / 100,
            count: data.count,
          }))
          .sort((a, b) => b.total - a.total);
        const grandTotal = departments.reduce((s, d) => s + d.total, 0);

        return NextResponse.json({
          success: true,
          data: {
            period: { from: from.toISOString(), to: to.toISOString() },
            departments,
            grandTotal: Math.round(grandTotal * 100) / 100,
          },
        });
      }

      case "getFinancialHealth": {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const [runway, burnRate, revenue, pnl, cashFlow, unpaidCount] = await Promise.all([
          getRunway(userId, organizationId),
          getBurnRate(userId, organizationId),
          getRevenueData(userId, organizationId),
          generatePnL(userId, organizationId, monthStart, monthEnd),
          projectCashFlow(userId, organizationId, 6),
          prisma.invoice.count({
            where: { userId, organizationId, status: { in: ["sent", "overdue"] } },
          }),
        ]);

        let score = 50;
        if (runway.runwayMonths >= 12) score += 30;
        else if (runway.runwayMonths >= 6) score += 20;
        else if (runway.runwayMonths >= 3) score += 10;
        else score -= 10;
        if (pnl.profitMargin > 20) score += 20;
        else if (pnl.profitMargin > 0) score += 10;
        else score -= 5;
        if (unpaidCount > 10) score -= 10;
        else if (unpaidCount > 5) score -= 5;
        score = Math.max(0, Math.min(100, score));

        const recommendations: string[] = [];
        if (runway.runwayMonths < 6) recommendations.push("Runway below 6 months — consider fundraising or cost cuts");
        if (unpaidCount > 3) recommendations.push(`${unpaidCount} unpaid invoices — send reminders`);
        if (burnRate.trend === "increasing") recommendations.push("Burn rate increasing — review expenses");

        return NextResponse.json({
          success: true,
          data: {
            score,
            status: score >= 70 ? "healthy" : score >= 40 ? "caution" : "critical",
            health: {
              runway: runway.runwayMonths,
              mrr: revenue.currentMRR,
              arr: revenue.currentARR,
              burnRate: burnRate.currentMonth,
              profitMargin: pnl.profitMargin,
              unpaidInvoices: unpaidCount,
            },
            projectedRunway: cashFlow.projectedRunway,
            revenueGrowth: revenue.growth,
            recommendations,
          },
        });
      }

      case "getRevenueByClient": {
        const revenues = await prisma.revenue.findMany({
      take: 200,
          where: { userId, organizationId },
          include: { client: true },
          orderBy: { month: "desc" },
        });

        const byClient = new Map<string, { name: string; total: number; recurring: number; oneTime: number }>();
        for (const r of revenues) {
          const key = r.clientId || "unattributed";
          const name = r.client?.name || "Unattributed";
          const existing = byClient.get(key) || { name, total: 0, recurring: 0, oneTime: 0 };
          const amount = Number(r.amount);
          byClient.set(key, {
            name,
            total: existing.total + amount,
            recurring: existing.recurring + (r.type === "recurring" ? amount : 0),
            oneTime: existing.oneTime + (r.type !== "recurring" ? amount : 0),
          });
        }

        const clients = Array.from(byClient.entries())
          .map(([clientId, data]) => ({
            clientId,
            ...data,
            total: Math.round(data.total * 100) / 100,
          }))
          .sort((a, b) => b.total - a.total);

        return NextResponse.json({ success: true, data: { clients } });
      }

      // ── ACTIONS ──────────────────────────────────────────

      case "createInvoice": {
        if (!params?.dueDate || !params?.lineItems?.length) {
          return NextResponse.json(
            { error: "params.dueDate and params.lineItems are required" },
            { status: 400 }
          );
        }
        const { calculateLineItemTotal } = await import("@/lib/gst");
        const count = await prisma.invoice.count({ where: { userId, organizationId } });
        const invoiceNumber = `INV-${String(count + 1).padStart(4, "0")}`;

        let subtotal = 0;
        let taxTotal = 0;
        const isInterState = params.isInterState || false;

        const processedItems = params.lineItems.map(
          (item: { description: string; quantity: number; unitPrice: number; gstRate: number }) => {
            const calc = calculateLineItemTotal(item.quantity, item.unitPrice, item.gstRate, isInterState);
            subtotal += calc.amount;
            taxTotal += calc.cgst + calc.sgst + calc.igst;
            return {
              description: item.description,
              quantity: calc.quantity,
              unitPrice: calc.unitPrice,
              amount: calc.amount,
              gstRate: item.gstRate,
              cgst: calc.cgst,
              sgst: calc.sgst,
              igst: calc.igst,
              total: calc.total,
            };
          }
        );
        const total = Math.round((subtotal + taxTotal) * 100) / 100;

        const invoice = await prisma.invoice.create({
          data: {
            invoiceNumber,
            userId,
            organizationId,
            clientId: params.clientId || undefined,
            dueDate: new Date(params.dueDate),
            subtotal,
            taxTotal,
            total,
            notes: params.notes,
            isInterState,
            lineItems: { create: processedItems },
          },
          include: { lineItems: true, client: true },
        });

        return NextResponse.json({ success: true, data: { invoice }, action: "invoice.created" }, { status: 201 });
      }

      case "logExpense": {
        if (!params?.description || !params?.amount) {
          return NextResponse.json(
            { error: "params.description and params.amount are required" },
            { status: 400 }
          );
        }

        const expense = await prisma.expense.create({
          data: {
            userId,
            organizationId,
            description: params.description,
            amount: params.amount,
            categoryId: params.categoryId || undefined,
            accountId: params.accountId || undefined,
            date: params.date ? new Date(params.date) : new Date(),
            vendor: params.vendor,
            notes: params.notes,
          },
          include: { category: true },
        });

        if (params.accountId) {
          await prisma.account.update({
            where: { id: params.accountId },
            data: { currentBalance: { decrement: params.amount } },
          });
        }

        return NextResponse.json({ success: true, data: { expense }, action: "expense.logged" }, { status: 201 });
      }

      default:
        return NextResponse.json({ error: `Unknown query: ${query}` }, { status: 400 });
    }
  } catch (error) {
    log.error("Copilot query error", { module: "copilot", action: "query", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to execute query" }, { status: 500 });
  }
}
