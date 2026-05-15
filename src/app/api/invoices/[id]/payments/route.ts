import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const PaymentSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  date: z.string().optional(),
  method: z.enum(["bank_transfer", "upi", "cash", "cheque", "card", "other"]).default("bank_transfer"),
  reference: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * GET /api/invoices/[id]/payments — List payments for an invoice
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const payments = await prisma.payment.findMany({
      take: 500,
      where: { invoiceId: id },
      orderBy: { date: "desc" },
    });

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { total: true, status: true },
    });

    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const invoiceTotal = Number(invoice?.total ?? 0);
    const balance = invoiceTotal - totalPaid;

    return NextResponse.json({
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        date: p.date.toISOString(),
        method: p.method,
        reference: p.reference,
        notes: p.notes,
      })),
      summary: {
        invoiceTotal,
        totalPaid,
        balance,
        isFullyPaid: balance <= 0,
        paymentCount: payments.length,
      },
    });
  } catch (error) {
    log.error("List payments error", { module: "invoices", action: "payments", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
  }
}

/**
 * POST /api/invoices/[id]/payments — Record a payment
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "invoice-payment" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;
    const rawBody = await request.json();
    const parsed = PaymentSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { amount, date, method, reference, notes } = parsed.data;

    // Get invoice and existing payments
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const existingPayments = await prisma.payment.findMany({
      take: 500,
      where: { invoiceId: id },
    });
    const totalPaid = existingPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const invoiceTotal = Number(invoice.total);
    const remaining = invoiceTotal - totalPaid;

    if (amount > remaining + 0.01) {
      return NextResponse.json(
        { error: `Amount exceeds remaining balance of ₹${remaining.toFixed(2)}` },
        { status: 400 }
      );
    }

    // RELIABILITY: Atomic transaction — payment creation + invoice status must succeed together
    const { payment, newStatus } = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          amount,
          date: date ? new Date(date) : new Date(),
          method: method || "bank_transfer",
          reference,
          notes,
          invoiceId: id,
          userId,
        },
      });

      // Auto-update invoice status
      const newTotalPaid = totalPaid + amount;
      let newStatus = invoice.status;
      if (newTotalPaid >= invoiceTotal) {
        newStatus = "paid";
      } else if (newTotalPaid > 0) {
        newStatus = "partial";
      }

      if (newStatus !== invoice.status) {
        await tx.invoice.update({
          where: { id },
          data: {
            status: newStatus,
            paidAt: newStatus === "paid" ? new Date() : undefined,
          },
        });
      }

      return { payment, newStatus };
    });

    const newTotalPaid = totalPaid + amount;

    logAudit({ userId, action: "create", resource: "payment", resourceId: payment.id, details: { invoiceId: id, amount, method, newStatus } });

    return NextResponse.json({
      payment: {
        id: payment.id,
        amount: Number(payment.amount),
        date: payment.date.toISOString(),
        method: payment.method,
        reference: payment.reference,
      },
      invoiceStatus: newStatus,
      totalPaid: newTotalPaid,
      balance: invoiceTotal - newTotalPaid,
    }, { status: 201 });
  } catch (error) {
    log.error("Create payment error", { module: "invoices", action: "payments", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}
