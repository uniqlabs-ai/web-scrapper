import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { CreateClientSchema } from "@/lib/schemas";
import { log, toLogError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // Build date filter
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      const d: Record<string, unknown> = {};
      if (from) d.gte = new Date(from);
      if (to) d.lte = new Date(to + "T23:59:59Z");
      dateFilter.issueDate = d;  // for invoices
    }
    const revDateFilter: Record<string, unknown> = {};
    if (from || to) {
      const d: Record<string, unknown> = {};
      if (from) d.gte = new Date(from);
      if (to) d.lte = new Date(to + "T23:59:59Z");
      revDateFilter.month = d;  // for revenues
    }

    const clients = await prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: 500, // RELIABILITY: Query boundary
      include: {
        invoices: {
          where: dateFilter,
          select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, issueDate: true },
          orderBy: { issueDate: "desc" },
        },
        revenues: {
          where: revDateFilter,
          select: { id: true, amount: true, month: true, type: true, source: true },
          orderBy: { month: "desc" },
        },
      },
    });

    // Compute billing summaries per client
    const enriched = clients.map((c) => ({
      ...c,
      totalInvoiced: c.invoices.reduce((s, inv) => s + Number(inv.total), 0),
      totalRevenue: c.revenues.reduce((s, r) => s + Number(r.amount), 0),
      invoiceCount: c.invoices.length,
      revenueCount: c.revenues.length,
      latestInvoiceCurrency: c.invoices[0]?.currency || "INR",
    }));

    return NextResponse.json({ clients: enriched });
  } catch (error) {
    log.error("List clients error", { module: "clients", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to list clients" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "clients" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const raw = await request.json();
    const result = CreateClientSchema.safeParse(raw);

    if (!result.success) {
      return NextResponse.json({ error: "Invalid payload", details: result.error.issues }, { status: 400 });
    }

    const { name, email, phone, company, gstNumber, address } = result.data;

    const client = await prisma.client.create({
      data: {
        userId,
        organizationId,
        name,
        email,
        phone,
        company,
        gstNumber,
        address,
      },
    });

    logAudit({ userId: client.userId, action: "create", resource: "client", resourceId: client.id, details: { name: client.name } });
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    log.error("Create client error", { module: "clients", action: "create", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
