import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const UpdateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  company: z.string().max(200).optional(),
  gstNumber: z.string().max(20).optional(),
  address: z.string().max(1000).optional(),
  displayName: z.string().max(200).optional(),
  aliases: z.any().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, organizationId } = await requireTenant();

    const client = await prisma.client.findFirst({
      where: { id, userId },
      include: {
        invoices: {
          select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, issueDate: true },
          orderBy: { issueDate: "desc" },
        },
        revenues: {
          select: { id: true, amount: true, month: true, type: true, source: true },
          orderBy: { month: "desc" },
        },
      },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const totalInvoiced = client.invoices.reduce((s, inv) => s + Number(inv.total), 0);
    const totalRevenue = client.revenues.reduce((s, r) => s + Number(r.amount), 0);

    // Monthly revenue from revenues + invoices
    const monthlyMap = new Map<string, number>();
    for (const r of client.revenues) {
      const m = new Date(r.month).toISOString().slice(0, 7);
      monthlyMap.set(m, (monthlyMap.get(m) || 0) + Number(r.amount));
    }
    for (const inv of client.invoices) {
      const m = new Date(inv.issueDate).toISOString().slice(0, 7);
      if (!monthlyMap.has(m)) monthlyMap.set(m, Number(inv.total));
    }
    const monthlyRevenue = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        amount,
      }));

    // Invoice status breakdown for pie chart
    const statusMap = new Map<string, number>();
    for (const inv of client.invoices) {
      const status = inv.status || "draft";
      statusMap.set(status, (statusMap.get(status) || 0) + Number(inv.total));
    }
    const statusBreakdown = [...statusMap.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));

    // Unified transaction list — each transaction carries its own currency
    const transactions = [
      ...client.invoices.map(inv => ({
        date: new Date(inv.issueDate).toISOString(),
        description: `Invoice ${inv.invoiceNumber}`,
        amount: Number(inv.total),
        category: inv.status === "paid" ? "Paid" : inv.status === "sent" ? "Sent" : "Draft",
        categoryColor: inv.status === "paid" ? "#22C55E" : inv.status === "sent" ? "#F59E0B" : "#94A3B8",
        currency: inv.currency || "INR",
      })),
      ...client.revenues.map(r => ({
        date: new Date(r.month).toISOString(),
        description: `Revenue: ${r.source || r.type}`,
        amount: Number(r.amount),
        category: r.type === "recurring" ? "Recurring" : "One-time",
        categoryColor: r.type === "recurring" ? "#818CF8" : "#06B6D4",
        currency: "INR",
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({
      client,
      totalInvoiced,
      totalRevenue,
      totalAmount: totalInvoiced + totalRevenue,
      txnCount: client.invoices.length + client.revenues.length,
      monthlyRevenue,
      statusBreakdown,
      transactions,
      currency: client.invoices[0]?.currency || "INR",
      invoiceCurrency: client.invoices[0]?.currency || "INR",
      revenueCurrency: "INR",
    });
  } catch (error) {
    log.error("Get client error", { module: "clients", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to get client" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "clients-update" });
    if (limited) return limited;
    const { id } = await params;
    const guard = await requirePermission("write");
    if (!guard.allowed) return guard.response;
    const rawBody = await request.json();

    const parsed = UpdateClientSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data as Record<string, unknown>;

    // Build update data from allowed fields, skipping undefined
    const allowedFields = ["name", "email", "phone", "company", "gstNumber", "address", "displayName", "aliases"];
    const updateData: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updateData[key] = body[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const client = await prisma.client.update({
      where: { id },
      data: updateData,
    });

    // Non-blocking audit log (safe to fail)
    try {
      logAudit({ userId: client.userId, action: "update", resource: "client", resourceId: id, details: { fields: Object.keys(updateData) } });
    } catch (_auditErr) {
      // Ignore audit errors
    }

    return NextResponse.json({ client });
  } catch (error) {
    log.error("Update client error", { module: "clients", action: "handler", error: toLogError(error) });
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to update client", detail: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const { organizationId, userId } = guard;

    const client = await prisma.client.findFirst({ where: { id, organizationId } });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await prisma.client.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "client", resourceId: id, details: { name: client.name } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete client error", { module: "clients", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
  }
}
