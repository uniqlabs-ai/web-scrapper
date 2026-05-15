import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const ReportPdfQuerySchema = z.object({
  type: z.enum(["pnl", "invoice"]).default("pnl"),
  from: z.string().optional(),
  to: z.string().optional(),
  invoiceId: z.string().min(1).optional(),
});

/**
 * GET /api/reports/pdf — Generate HTML-based PDF-ready report (P&L or Balance Sheet)
 * Browser can use window.print() or a PDF library to convert
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const parsed = ReportPdfQuerySchema.safeParse({
      type: searchParams.get("type") || undefined,
      from: searchParams.get("from") || undefined,
      to: searchParams.get("to") || undefined,
      invoiceId: searchParams.get("invoiceId") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { type, from, to, invoiceId } = parsed.data;

    if (type === "invoice" && invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, userId, organizationId },
        include: {
          client: true,
          lineItems: true,
        },
      });

      if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

      const org = await prisma.organization.findFirst({ where: { id: organizationId } });

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${invoice.invoiceNumber}</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;margin:0;padding:40px;color:#1a1a1a;font-size:13px}
  .header{display:flex;justify-content:space-between;margin-bottom:40px}
  .company{font-size:20px;font-weight:800;color:#6366F1}
  .invoice-title{font-size:28px;font-weight:800;color:#333;margin-bottom:8px}
  .meta{color:#666;line-height:1.8}
  .meta strong{color:#333}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  thead{background:#f4f4f5}
  th{text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #e5e7eb}
  td{padding:10px 12px;border-bottom:1px solid #f0f0f0}
  .text-right{text-align:right}
  .totals{margin-left:auto;width:280px}
  .totals div{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}
  .totals .grand{font-size:18px;font-weight:800;border-top:2px solid #333;padding-top:12px;margin-top:8px}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;color:#999;font-size:11px;text-align:center}
  @media print{body{padding:20px}@page{margin:15mm}}
</style></head><body>
  <div class="header">
    <div>
      <div class="company">${org?.name || "Your Company"}</div>
      <div style="color:#999;font-size:12px">${org?.gstNumber ? `GSTIN: ${org.gstNumber}` : ""}</div>
    </div>
    <div style="text-align:right">
      <div class="invoice-title">INVOICE</div>
      <div class="meta">
        <strong>#${invoice.invoiceNumber}</strong><br>
        Date: ${invoice.issueDate.toLocaleDateString("en-IN")}<br>
        Due: ${invoice.dueDate.toLocaleDateString("en-IN")}
      </div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-bottom:24px">
    <div>
      <div style="font-size:11px;text-transform:uppercase;color:#999;margin-bottom:4px">Bill To</div>
      <div style="font-weight:600">${invoice.client?.name || "—"}</div>
      <div style="color:#666">${invoice.client?.company || ""}</div>
      <div style="color:#666;font-size:11px">${invoice.client?.gstNumber ? `GSTIN: ${invoice.client.gstNumber}` : ""}</div>
    </div>
    <div style="text-align:right">
      <span style="padding:4px 12px;border-radius:4px;font-size:11px;font-weight:700;background:${invoice.status === "paid" ? "#dcfce7" : "#fef3c7"};color:${invoice.status === "paid" ? "#16a34a" : "#d97706"}">${invoice.status.toUpperCase()}</span>
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th>HSN/SAC</th><th class="text-right">Qty</th><th class="text-right">Rate</th><th class="text-right">Tax</th><th class="text-right">Amount</th></tr></thead>
    <tbody>
      ${invoice.lineItems.map((item) => `
        <tr>
          <td>${item.description}</td>
          <td style="color:#888">—</td>
          <td class="text-right">${item.quantity}</td>
          <td class="text-right">₹${Number(item.unitPrice).toLocaleString("en-IN")}</td>
          <td class="text-right" style="color:#888">₹${(Number(item.cgst) + Number(item.sgst) + Number(item.igst)).toLocaleString("en-IN")}</td>
          <td class="text-right" style="font-weight:600">₹${Number(item.amount).toLocaleString("en-IN")}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><span>₹${Number(invoice.subtotal).toLocaleString("en-IN")}</span></div>
    <div><span>Tax</span><span>₹${Number(invoice.taxTotal).toLocaleString("en-IN")}</span></div>
    <div class="grand"><span>Total</span><span>₹${Number(invoice.total).toLocaleString("en-IN")}</span></div>
  </div>

  ${invoice.notes ? `<div style="margin-top:32px;padding:16px;background:#f9fafb;border-radius:8px;font-size:12px;color:#666"><strong>Notes:</strong> ${invoice.notes}</div>` : ""}

  <div class="footer">Generated by Finance Suite • ${new Date().toLocaleDateString("en-IN")}</div>
</body></html>`;

      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // P&L PDF
    const dateFrom = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const dateTo = to ? new Date(to) : new Date();

    const [revenues, expenses] = await Promise.all([
      prisma.revenue.findMany({ where: { userId, organizationId, month: { gte: dateFrom, lte: dateTo } }, take: 10_000 }),
      prisma.expense.findMany({ where: { userId, organizationId, date: { gte: dateFrom, lte: dateTo } }, include: { category: true }, take: 10_000 }),
    ]);

    const totalRevenue = revenues.reduce((s, r) => s + Number(r.amount), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const netProfit = totalRevenue - totalExpenses;

    // Group expenses by category
    const expByCategory: Record<string, number> = {};
    for (const e of expenses) {
      const cat = e.category?.name || "Uncategorized";
      expByCategory[cat] = (expByCategory[cat] || 0) + Number(e.amount);
    }

    const { formatCurrency: fmt } = await import("@/lib/currency");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Profit & Loss Statement</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;margin:0;padding:40px;color:#1a1a1a;font-size:13px}
  h1{font-size:24px;margin:0 0 4px}
  .period{color:#999;margin-bottom:32px;font-size:12px}
  .section{margin-bottom:24px}
  .section-title{font-size:14px;font-weight:700;text-transform:uppercase;color:#6366F1;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
  .row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}
  .row.total{font-weight:800;font-size:15px;padding-top:12px;border-top:2px solid #333;margin-top:8px}
  .green{color:#16a34a}.red{color:#dc2626}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;color:#999;font-size:11px;text-align:center}
  @media print{body{padding:20px}@page{margin:15mm}}
</style></head><body>
  <h1>Profit & Loss Statement</h1>
  <div class="period">${dateFrom.toLocaleDateString("en-IN")} — ${dateTo.toLocaleDateString("en-IN")}</div>

  <div class="section">
    <div class="section-title">Revenue</div>
    <div class="row"><span>Total Revenue</span><span class="green">${fmt(totalRevenue)}</span></div>
  </div>

  <div class="section">
    <div class="section-title">Expenses</div>
    ${Object.entries(expByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) =>
      `<div class="row"><span>${cat}</span><span>${fmt(amt)}</span></div>`
    ).join("")}
    <div class="row total"><span>Total Expenses</span><span class="red">${fmt(totalExpenses)}</span></div>
  </div>

  <div class="section">
    <div class="row total" style="font-size:20px">
      <span>Net ${netProfit >= 0 ? "Profit" : "Loss"}</span>
      <span class="${netProfit >= 0 ? "green" : "red"}">${fmt(netProfit)}</span>
    </div>
  </div>

  <div class="footer">Generated by Finance Suite • ${new Date().toLocaleDateString("en-IN")}</div>
</body></html>`;

    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    log.error("PDF report error", { module: "reports", action: "pdf", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
