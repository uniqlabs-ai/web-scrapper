import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const CfoBriefEmailSchema = z.object({
  email: z.string().email("Valid email is required"),
});

/**
 * GET  /api/reports/cfo-brief — Generate weekly CFO brief data (preview)
 * POST /api/reports/cfo-brief — Generate + email the weekly brief
 */

async function buildBrief(userId: string, organizationId: string) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fyStart = now.getMonth() >= 3
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1);

  const [expenses, revenues, invoices, bankAccounts, user] = await Promise.all([
    prisma.expense.findMany({ where: { userId, organizationId, date: { gte: fyStart } }, include: { category: true }, take: 10_000 }),
    prisma.revenue.findMany({ where: { userId, organizationId, month: { gte: fyStart } }, take: 10_000 }),
    prisma.invoice.findMany({ where: { userId, organizationId }, include: { payments: true }, take: 10_000 }),
    prisma.bankAccount.findMany({ where: { userId, isActive: true }, take: 100 }),
    prisma.user.findUnique({ where: { id: userId }, include: { organization: true } }),
  ]);

  // This week's expenses
  const weekExpenses = expenses.filter((e) => e.date >= weekAgo);
  const weekTotal = weekExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const weekCategories: Record<string, number> = {};
  for (const e of weekExpenses) {
    const cat = e.category?.name || "Uncategorized";
    weekCategories[cat] = (weekCategories[cat] || 0) + Number(e.amount);
  }
  const topWeekCats = Object.entries(weekCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amount]) => ({ name, amount }));

  // Month-to-date
  const mtdExpenses = expenses.filter((e) => e.date >= monthStart);
  const mtdTotal = mtdExpenses.reduce((s, e) => s + Number(e.amount), 0);

  // Revenue
  const totalRevenue = revenues.reduce((s, r) => s + Number(r.amount), 0);
  const monthlyRevenue: Record<string, number> = {};
  for (const r of revenues) {
    const key = r.month.toISOString().slice(0, 7);
    monthlyRevenue[key] = (monthlyRevenue[key] || 0) + Number(r.amount);
  }
  const avgMonthlyRevenue = Object.values(monthlyRevenue).length > 0
    ? Object.values(monthlyRevenue).reduce((s, v) => s + v, 0) / Object.values(monthlyRevenue).length
    : 0;

  // Receivables
  const unpaid = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled");
  const totalReceivables = unpaid.reduce((s, i) => s + Number(i.total), 0);
  const overdue = unpaid.filter((i) => i.dueDate < now);
  const overdueTotal = overdue.reduce((s, i) => s + Number(i.total), 0);

  // Cash position
  const totalCash = bankAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const months = Object.keys(monthlyRevenue).length || 1;
  const avgMonthlyExpenses = totalExpenses / months;
  const runwayMonths = avgMonthlyExpenses > 0 ? Math.round(totalCash / avgMonthlyExpenses) : 99;

  // PnL
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

  // Alerts
  const alerts: string[] = [];
  if (runwayMonths < 6) alerts.push(`⚠️ Cash runway is only ${runwayMonths} months`);
  if (overdueTotal > 0) alerts.push(`⚠️ ₹${overdueTotal.toLocaleString("en-IN")} in overdue invoices`);
  if (profitMargin < 0) alerts.push(`🔴 Operating at a loss (${profitMargin}% margin)`);
  if (weekTotal > avgMonthlyExpenses * 0.35) alerts.push(`📈 This week's spend (₹${weekTotal.toLocaleString("en-IN")}) is >35% of monthly avg`);

  const companyName = user?.organization?.name || "Your Company";

  return {
    companyName,
    period: { from: weekAgo.toISOString(), to: now.toISOString() },
    weekSummary: {
      totalSpend: weekTotal,
      topCategories: topWeekCats,
      transactionCount: weekExpenses.length,
    },
    monthToDate: { totalSpend: mtdTotal },
    revenue: {
      totalFY: totalRevenue,
      avgMonthly: Math.round(avgMonthlyRevenue),
    },
    receivables: {
      outstanding: totalReceivables,
      overdue: overdueTotal,
      overdueCount: overdue.length,
    },
    cashPosition: {
      totalCash,
      runwayMonths,
    },
    profitability: {
      netProfit,
      profitMargin,
    },
    alerts,
  };
}

function formatINR(n: number) {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function buildEmailHTML(brief: Awaited<ReturnType<typeof buildBrief>>) {
  const weekFrom = new Date(brief.period.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const weekTo = new Date(brief.period.to).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const alertsHTML = brief.alerts.length > 0
    ? `<div style="margin-bottom: 24px; padding: 16px; border-radius: 8px; background: #FEF3C7; border: 1px solid #F59E0B;">
        <strong style="color: #92400E;">⚡ Attention Required</strong>
        <ul style="margin: 8px 0 0; padding-left: 20px; color: #78350F;">
          ${brief.alerts.map((a) => `<li style="margin: 4px 0;">${a}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const topCatsHTML = brief.weekSummary.topCategories
    .map((c) => `<tr><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb;">${c.name}</td><td style="padding: 6px 0; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">${formatINR(c.amount)}</td></tr>`)
    .join("");

  return `
    <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 640px; margin: 0 auto; padding: 32px; background: #ffffff; color: #1a1a1a;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #111827;">📊 Weekly CFO Brief</h1>
        <p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">${brief.companyName} · ${weekFrom} – ${weekTo}</p>
      </div>

      ${alertsHTML}

      <!-- Key Metrics -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 16px; text-align: center; background: #F0FDF4; border-radius: 8px 0 0 0;">
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Cash Balance</div>
            <div style="font-size: 20px; font-weight: 800; color: #16A34A;">${formatINR(brief.cashPosition.totalCash)}</div>
          </td>
          <td style="padding: 16px; text-align: center; background: ${brief.profitability.profitMargin >= 0 ? "#F0FDF4" : "#FEF2F2"}; border-radius: 0 8px 0 0;">
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Profit Margin</div>
            <div style="font-size: 20px; font-weight: 800; color: ${brief.profitability.profitMargin >= 0 ? "#16A34A" : "#DC2626"};">${brief.profitability.profitMargin}%</div>
          </td>
        </tr>
        <tr>
          <td style="padding: 16px; text-align: center; background: #EFF6FF; border-radius: 0 0 0 8px;">
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Runway</div>
            <div style="font-size: 20px; font-weight: 800; color: ${brief.cashPosition.runwayMonths < 6 ? "#DC2626" : "#2563EB"};">${brief.cashPosition.runwayMonths >= 99 ? "∞" : brief.cashPosition.runwayMonths + " months"}</div>
          </td>
          <td style="padding: 16px; text-align: center; background: ${brief.receivables.overdue > 0 ? "#FEF2F2" : "#EFF6FF"}; border-radius: 0 0 8px 0;">
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Outstanding AR</div>
            <div style="font-size: 20px; font-weight: 800; color: ${brief.receivables.overdue > 0 ? "#DC2626" : "#2563EB"};">${formatINR(brief.receivables.outstanding)}</div>
          </td>
        </tr>
      </table>

      <!-- This Week -->
      <h3 style="font-size: 16px; margin: 0 0 12px; color: #111827;">This Week's Spend</h3>
      <p style="margin: 0 0 12px; color: #6b7280; font-size: 14px;">
        <strong style="color: #111827;">${formatINR(brief.weekSummary.totalSpend)}</strong> across ${brief.weekSummary.transactionCount} transactions
      </p>
      ${topCatsHTML ? `<table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">${topCatsHTML}</table>` : ""}

      <!-- Month-to-Date -->
      <div style="display: flex; gap: 16px; margin-bottom: 24px;">
        <div style="flex: 1; padding: 16px; background: #F3F4F6; border-radius: 8px;">
          <div style="font-size: 12px; color: #6b7280;">Month-to-Date Spend</div>
          <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${formatINR(brief.monthToDate.totalSpend)}</div>
        </div>
        <div style="flex: 1; padding: 16px; background: #F3F4F6; border-radius: 8px;">
          <div style="font-size: 12px; color: #6b7280;">Avg Monthly Revenue</div>
          <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${formatINR(brief.revenue.avgMonthly)}</div>
        </div>
      </div>

      ${brief.receivables.overdueCount > 0 ? `
      <div style="padding: 16px; background: #FEF2F2; border-radius: 8px; margin-bottom: 24px;">
        <strong style="color: #991B1B;">Overdue Invoices</strong>
        <p style="margin: 4px 0 0; color: #7F1D1D; font-size: 14px;">
          ${brief.receivables.overdueCount} invoices worth ${formatINR(brief.receivables.overdue)} are past due.
        </p>
      </div>
      ` : ""}

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="text-align: center; font-size: 12px; color: #9ca3af;">
        Generated by Founder OS Finance · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
      </p>
    </div>
  `;
}

export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const brief = await buildBrief(userId, organizationId);
    return NextResponse.json(brief);
  } catch (error) {
    log.error("CFO brief error", { module: "reports", action: "cfo-brief", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to generate brief" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = CfoBriefEmailSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { email } = parsed.data;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "Email service not configured (RESEND_API_KEY)" }, { status: 503 });
    }

    const brief = await buildBrief(userId, organizationId);
    const html = buildEmailHTML(brief);
    const weekTo = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${brief.companyName} Finance <reports@${process.env.RESEND_DOMAIN || "finance.founderOS.app"}>`,
        to: email,
        subject: `📊 Weekly CFO Brief — ${brief.companyName} (${weekTo})`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      log.error("Resend error", { module: "reports", action: "cfo-brief", error: toLogError(err) });
      return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: `CFO brief sent to ${email}` });
  } catch (error) {
    log.error("CFO brief email error", { module: "reports", action: "cfo-brief", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to send brief" }, { status: 500 });
  }
}
