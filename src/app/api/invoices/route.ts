import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateLineItemTotal } from "@/lib/gst";
import { requireTenant, TenantError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { log, toLogError } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

const NextInvoiceSchema = z.object({
  clientId: z.string().optional(),
  dueDate: z.string().refine(v => !isNaN(Date.parse(v)), { message: "Invalid dueDate format" }),
  notes: z.string().optional(),
  gstNumber: z.string().optional(),
  placeOfSupply: z.string().optional(),
  isInterState: z.boolean().default(false),
  lineItems: z.array(z.object({
    description: z.string().min(1, "Description is required"),
    quantity: z.number().min(0.01, "Quantity must be > 0"),
    unitPrice: z.number().min(0, "Unit price cannot be negative"),
    gstRate: z.number().min(0, "GST must be non-negative")
  })).min(1, "At least one line item is required")
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const { userId, organizationId } = await requireTenant();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user || !user.organizationId) {
       return NextResponse.json({ invoices: [] });
    }

    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (status) where.status = status;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      const d: Record<string, unknown> = {};
      if (from) d.gte = new Date(from);
      if (to) d.lte = new Date(to + "T23:59:59Z");
      where.issueDate = d;
    }

    const invoices = await prisma.invoice.findMany({
      take: 500,
      where,
      include: { client: true, lineItems: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ invoices });
  } catch (error) {
    log.error("List invoices error", { module: "invoices", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to list invoices" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 15, prefix: "invoices" });
    if (limited) return limited;
    const rawBody = await request.json();
    const result = NextInvoiceSchema.safeParse(rawBody);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: result.error.issues },
        { status: 400 }
      );
    }

    const {
      clientId,
      dueDate,
      notes,
      gstNumber,
      placeOfSupply,
      isInterState,
      lineItems,
    } = result.data;

    const { userId, organizationId } = await requireTenant();

    const count = await prisma.invoice.count({
      where: { organizationId },
    });
    const invoiceNumber = `INV-${String(count + 1).padStart(4, "0")}`;

    let subtotal = 0;
    let taxTotal = 0;

    const processedItems = lineItems.map(
      (item: {
        description: string;
        quantity: number;
        unitPrice: number;
        gstRate: number;
      }) => {
        const calc = calculateLineItemTotal(
          item.quantity,
          item.unitPrice,
          item.gstRate,
          isInterState
        );
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

    // RELIABILITY: Atomic transaction — invoice + line items created together
    const invoice = await prisma.$transaction(async (tx) => {
      return tx.invoice.create({
        data: {
          invoiceNumber,
          userId,
          organizationId,
          clientId: clientId || undefined,
          dueDate: new Date(dueDate),
          subtotal,
          taxTotal,
          total,
          notes,
          gstNumber,
          placeOfSupply,
          isInterState,
          lineItems: {
            create: processedItems,
          },
        },
        include: { lineItems: true, client: true },
      });
    });

    logAudit({ userId: invoice.userId, action: "create", resource: "invoice", resourceId: invoice.id, details: { invoiceNumber: invoice.invoiceNumber, total: invoice.total } });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    log.error("Create invoice error", { module: "invoices", action: "handler", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to create invoice" },
      { status: 500 }
    );
  }
}
