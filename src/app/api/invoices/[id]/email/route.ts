import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { generateInvoicePDF } from "@/lib/pdf";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const InvoiceIdParamSchema = z.object({
  id: z.string().min(1, "Invoice ID is required"),
});

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = rateLimit(_request, { windowSec: 60, max: 10, prefix: "invoice-email" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawParams = await params;
    const paramsParsed = InvoiceIdParamSchema.safeParse(rawParams);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: paramsParsed.error.issues }, { status: 400 });
    }
    const { id } = paramsParsed.data;

    const invoice = await prisma.invoice.findFirst({
      where: { id, userId, organizationId },
      include: {
        client: true,
        lineItems: true,
        organization: true,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (!invoice.client?.email) {
      return NextResponse.json(
        { error: "Client has no email address" },
        { status: 400 }
      );
    }

    let paymentUpiId: string | undefined = undefined;
    if (invoice.organization?.alertSettings) {
      try {
        const settings = JSON.parse(invoice.organization.alertSettings);
        if (settings.paymentUpiId) paymentUpiId = settings.paymentUpiId;
      } catch (e: unknown) {
        log.warn("Malformed alertSettings JSON", { module: "invoices", action: "email", meta: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    const pdfBuffer = generateInvoicePDF({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      status: invoice.status,
      clientName: invoice.client.name,
      clientEmail: invoice.client.email,
      clientCompany: invoice.client.company || undefined,
      clientAddress: invoice.client.address || undefined,
      clientGstNumber: invoice.client.gstNumber || undefined,
      companyName: invoice.organization?.name || undefined,
      companyAddress: invoice.organization?.address || undefined,
      companyGstNumber: invoice.organization?.gstNumber || undefined,
      lineItems: invoice.lineItems.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount),
        gstRate: Number(item.gstRate),
        cgst: Number(item.cgst),
        sgst: Number(item.sgst),
        igst: Number(item.igst),
        total: Number(item.total),
      })),
      subtotal: Number(invoice.subtotal),
      taxTotal: Number(invoice.taxTotal),
      total: Number(invoice.total),
      isInterState: invoice.isInterState ?? false,
      currency: invoice.currency,
      notes: invoice.notes || undefined,
      paymentUpiId,
    });

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json(
        { error: "Email service not configured" },
        { status: 503 }
      );
    }

    const companyName = invoice.organization?.name || "Founder OS Finance";

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${companyName} <invoices@${process.env.RESEND_DOMAIN || "finance.founderOS.app"}>`,
        to: invoice.client.email,
        subject: `Invoice ${invoice.invoiceNumber} from ${companyName}`,
        html: `
          <div style="font-family: Inter, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
            <h2 style="margin: 0 0 8px;">Invoice ${invoice.invoiceNumber}</h2>
            <p style="color: #6b7280; margin: 0 0 24px;">
              Hi ${invoice.client.name},<br/><br/>
              Please find your invoice attached below.
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Amount Due</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">
                  ₹${Number(invoice.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Due Date</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                  ${invoice.dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </td>
              </tr>
            </table>
            ${paymentUpiId && invoice.status !== "paid" ? `
            <div style="margin-bottom: 24px; text-align: center;">
              <a href="upi://pay?pa=${paymentUpiId}&pn=${encodeURIComponent(companyName)}&am=${invoice.total}&tr=${invoice.invoiceNumber}&cu=INR" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Pay Instantly via UPI</a>
            </div>` : ""}
            <p style="color: #9ca3af; font-size: 12px;">
              Sent via Founder OS Finance
            </p>
          </div>
        `,
        attachments: [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            content: pdfBuffer.toString("base64"),
          },
        ],
      }),
    });

    if (!emailResponse.ok) {
      const err = await emailResponse.text();
      log.error("Resend API error", { module: "invoices", action: "email", error: toLogError(err) });
      return NextResponse.json(
        { error: "Failed to send email" },
        { status: 502 }
      );
    }

    // Mark invoice as sent
    await prisma.invoice.update({
      where: { id },
      data: { status: "sent" },
    });

    return NextResponse.json({
      success: true,
      message: `Invoice emailed to ${invoice.client.email}`,
    });
  } catch (error) {
    log.error("Email invoice error", { module: "invoices", action: "email", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to email invoice" },
      { status: 500 }
    );
  }
}
