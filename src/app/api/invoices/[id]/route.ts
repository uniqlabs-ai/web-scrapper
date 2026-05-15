import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { UpdateInvoiceSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, organizationId } = await requireTenant();
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { client: true, lineItems: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ invoice });
  } catch (error) {
    log.error("Get invoice error", { module: "invoices", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to get invoice" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "invoice-update" });
    if (limited) return limited;
    const { id } = await params;
    const guard = await requirePermission("write");
    if (!guard.allowed) return guard.response;
    const body = await request.json();
    const parsed = UpdateInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        notes: body.notes,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        status: body.status,
      },
      include: { lineItems: true, client: true },
    });

    return NextResponse.json({ invoice });
  } catch (error) {
    log.error("Update invoice error", { module: "invoices", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to update invoice" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, organizationId } = await requireTenant();
    const existing = await prisma.invoice.findFirst({ where: { id } });
    await prisma.invoice.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "invoice", resourceId: id, details: { invoiceNumber: existing?.invoiceNumber } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete invoice error", { module: "invoices", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to delete invoice" },
      { status: 500 }
    );
  }
}
