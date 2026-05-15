import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const InvoiceActionParamsSchema = z.object({
  id: z.string().min(1, "Invoice ID is required"),
  action: z.enum(["send", "paid"], { message: "Action must be 'send' or 'paid'" }),
});

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  try {
    const limited = rateLimit(_request, { windowSec: 60, max: 30, prefix: "invoice-action" });
    if (limited) return limited;
    const rawParams = await params;
    const paramsParsed = InvoiceActionParamsSchema.safeParse(rawParams);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: paramsParsed.error.issues }, { status: 400 });
    }
    const { id, action } = paramsParsed.data;
    const { userId, organizationId } = await requireTenant();

    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    let updateData: Record<string, unknown> = {};

    switch (action) {
      case "send":
        if (invoice.status !== "draft") {
          return NextResponse.json(
            { error: "Only draft invoices can be sent" },
            { status: 400 }
          );
        }
        updateData = { status: "sent", sentAt: new Date() };
        break;

      case "paid":
        if (!["sent", "overdue"].includes(invoice.status)) {
          return NextResponse.json(
            { error: "Only sent or overdue invoices can be marked as paid" },
            { status: 400 }
          );
        }
        updateData = { status: "paid", paidAt: new Date() };
        break;

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: updateData,
      include: { lineItems: true, client: true },
    });

    logAudit({ userId, action: "update", resource: "invoice", resourceId: id, details: { invoiceAction: action, newStatus: updateData.status } });
    return NextResponse.json({ invoice: updated });
  } catch (error) {
    log.error("Invoice action error", { module: "invoices", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to perform action" },
      { status: 500 }
    );
  }
}
