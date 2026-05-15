import { prisma } from "@/lib/prisma";

export interface PnLLine {
  label: string;
  amount: number;
}

export interface PnLReport {
  period: { from: string; to: string };
  revenue: PnLLine[];
  totalRevenue: number;
  expenses: PnLLine[];
  totalExpenses: number;
  grossProfit: number;
  netIncome: number;
  profitMargin: number;
}

export async function generatePnL(
  userId: string,
  organizationId: string,
  from: Date,
  to: Date
): Promise<PnLReport> {
  const [revenues, expenses] = await Promise.all([
    prisma.revenue.findMany({
      where: { userId, organizationId, month: { gte: from, lte: to } },
      include: { client: true },
      take: 10_000, // RELIABILITY: Safety ceiling
    }),
    prisma.expense.findMany({
      where: { userId, organizationId, date: { gte: from, lte: to } },
      include: { category: true },
      take: 10_000, // RELIABILITY: Safety ceiling
    }),
  ]);

  // Group revenue by type
  const revByType = new Map<string, number>();
  for (const r of revenues) {
    const key = r.type === "recurring" ? "Recurring Revenue" : "One-time Revenue";
    revByType.set(key, (revByType.get(key) || 0) + Number(r.amount));
  }

  const revenueLines: PnLLine[] = Array.from(revByType.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);

  const totalRevenue = revenueLines.reduce((s, l) => s + l.amount, 0);

  // Group expenses by category
  const expByCat = new Map<string, number>();
  for (const e of expenses) {
    const key = e.category?.name || e.department || "Uncategorized";
    expByCat.set(key, (expByCat.get(key) || 0) + Number(e.amount));
  }

  const expenseLines: PnLLine[] = Array.from(expByCat.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);

  const totalExpenses = expenseLines.reduce((s, l) => s + l.amount, 0);
  const grossProfit = totalRevenue - totalExpenses;
  const netIncome = grossProfit;
  const profitMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    revenue: revenueLines,
    totalRevenue,
    expenses: expenseLines,
    totalExpenses,
    grossProfit,
    netIncome,
    profitMargin: Math.round(profitMargin * 100) / 100,
  };
}

export interface CashFlowProjection {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
}

export async function projectCashFlow(
  userId: string,
  organizationId: string,
  months: number = 6
): Promise<{
  projections: CashFlowProjection[];
  currentBalance: number;
  projectedRunway: number;
}> {
  // Get last 3 months of data for averaging
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const [revenues, expenses, org] = await Promise.all([
    prisma.revenue.findMany({
      where: { userId, organizationId, month: { gte: threeMonthsAgo } },
      take: 5000, // RELIABILITY: Safety ceiling
    }),
    prisma.expense.findMany({
      where: { userId, organizationId, date: { gte: threeMonthsAgo } },
      take: 5000, // RELIABILITY: Safety ceiling
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
    }),
  ]);

  const currentBalance = Number(org?.cashInBank ?? 0);

  // Calculate monthly averages
  const revenueByMonth = new Map<string, number>();
  for (const r of revenues) {
    const key = `${r.month.getFullYear()}-${r.month.getMonth()}`;
    revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + Number(r.amount));
  }

  const expenseByMonth = new Map<string, number>();
  for (const e of expenses) {
    const key = `${e.date.getFullYear()}-${e.date.getMonth()}`;
    expenseByMonth.set(key, (expenseByMonth.get(key) || 0) + Number(e.amount));
  }

  const avgInflow =
    revenueByMonth.size > 0
      ? Array.from(revenueByMonth.values()).reduce((s, v) => s + v, 0) / revenueByMonth.size
      : 0;

  const avgOutflow =
    expenseByMonth.size > 0
      ? Array.from(expenseByMonth.values()).reduce((s, v) => s + v, 0) / expenseByMonth.size
      : 0;

  // Generate projections
  const projections: CashFlowProjection[] = [];
  let balance = currentBalance;
  let runwayMonths = months;

  for (let i = 0; i < months; i++) {
    const date = new Date();
    date.setMonth(date.getMonth() + i + 1);
    const monthStr = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });

    const net = avgInflow - avgOutflow;
    balance += net;

    if (balance <= 0 && runwayMonths === months) {
      runwayMonths = i + 1;
    }

    projections.push({
      month: monthStr,
      inflow: Math.round(avgInflow),
      outflow: Math.round(avgOutflow),
      net: Math.round(net),
      balance: Math.round(Math.max(0, balance)),
    });
  }

  return { projections, currentBalance, projectedRunway: runwayMonths };
}

export interface CashFlowOutlookSnapshot {
  label: string;
  days: number;
  projectedBalance: number;
  expectedInflows: number;
  expectedOutflows: number;
  risk: "green" | "amber" | "red";
}

export async function projectCashFlowOutlook(
  userId: string,
  organizationId: string
): Promise<{
  snapshots: CashFlowOutlookSnapshot[];
  currentBalance: number;
  avgMonthlyBurn: number;
}> {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getTime() - 90 * 86400000);

  const [revenues, expenses, org, unpaidInvoices, recurringItems] = await Promise.all([
    prisma.revenue.findMany({ where: { userId, organizationId, month: { gte: threeMonthsAgo } }, take: 5000 }),
    prisma.expense.findMany({ where: { userId, organizationId, date: { gte: threeMonthsAgo } }, take: 5000 }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.invoice.findMany({
      where: { userId, organizationId, status: { in: ["sent", "overdue"] } },
      select: { total: true, dueDate: true },
      take: 1000, // RELIABILITY: Safety ceiling
    }),
    prisma.recurringExpense.findMany({
      where: { userId, organizationId, isActive: true },
      select: { amount: true, frequency: true },
      take: 500, // RELIABILITY: Safety ceiling
    }),
  ]);

  const currentBalance = Number(org?.cashInBank ?? 0);

  // Monthly averages from last 3 months
  const revenueByMonth = new Map<string, number>();
  for (const r of revenues) {
    const key = `${r.month.getFullYear()}-${r.month.getMonth()}`;
    revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + Number(r.amount));
  }
  const expenseByMonth = new Map<string, number>();
  for (const e of expenses) {
    const key = `${e.date.getFullYear()}-${e.date.getMonth()}`;
    expenseByMonth.set(key, (expenseByMonth.get(key) || 0) + Number(e.amount));
  }

  const avgMonthlyInflow = revenueByMonth.size > 0
    ? Array.from(revenueByMonth.values()).reduce((s, v) => s + v, 0) / revenueByMonth.size : 0;
  const avgMonthlyOutflow = expenseByMonth.size > 0
    ? Array.from(expenseByMonth.values()).reduce((s, v) => s + v, 0) / expenseByMonth.size : 0;
  const avgMonthlyBurn = avgMonthlyOutflow - avgMonthlyInflow;

  // Monthly recurring obligation
  const monthlyRecurring = recurringItems.reduce((sum, r) => {
    const amt = Number(r.amount);
    if (r.frequency === "weekly") return sum + amt * 4.33;
    if (r.frequency === "monthly") return sum + amt;
    if (r.frequency === "quarterly") return sum + amt / 3;
    if (r.frequency === "yearly" || r.frequency === "annual") return sum + amt / 12;
    return sum + amt;
  }, 0);

  const snapshots: CashFlowOutlookSnapshot[] = [30, 60, 90].map((days) => {
    const fraction = days / 30;

    // Expected AR collections within this window
    const cutoff = new Date(now.getTime() + days * 86400000);
    const expectedAR = unpaidInvoices
      .filter((inv) => new Date(inv.dueDate) <= cutoff)
      .reduce((sum, inv) => sum + Number(inv.total), 0);

    // Weighted collection probability (older invoices less likely)
    const expectedInflows = Math.round(avgMonthlyInflow * fraction + expectedAR * 0.6);
    const expectedOutflows = Math.round((avgMonthlyOutflow + monthlyRecurring * 0.3) * fraction);
    const projectedBalance = Math.round(currentBalance + expectedInflows - expectedOutflows);

    const burnMonths = avgMonthlyBurn > 0 ? currentBalance / avgMonthlyBurn : 99;
    const risk: "green" | "amber" | "red" =
      projectedBalance <= 0 ? "red" :
      burnMonths < 6 || projectedBalance < currentBalance * 0.3 ? "amber" : "green";

    return {
      label: `${days}-Day`,
      days,
      projectedBalance,
      expectedInflows,
      expectedOutflows,
      risk,
    };
  });

  return { snapshots, currentBalance, avgMonthlyBurn: Math.round(avgMonthlyBurn) };
}

export interface GSTSummary {
  period: { from: string; to: string };
  outputTax: { cgst: number; sgst: number; igst: number; total: number };
  inputTax: number;
  netPayable: number;
  invoiceCount: number;
  expenseCount: number;
}

export async function calculateGSTSummary(
  userId: string,
  organizationId: string,
  from: Date,
  to: Date
): Promise<GSTSummary> {
  const [invoices, expenses] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        userId,
        organizationId,
        issueDate: { gte: from, lte: to },
        status: { not: "draft" },
      },
      include: { lineItems: true },
      take: 10_000, // RELIABILITY: Safety ceiling
    }),
    prisma.expense.findMany({
      where: { userId, organizationId, date: { gte: from, lte: to } },
      take: 10_000, // RELIABILITY: Safety ceiling
    }),
  ]);

  // Output tax from invoices
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  for (const inv of invoices) {
    for (const item of inv.lineItems) {
      totalCGST += Number(item.cgst);
      totalSGST += Number(item.sgst);
      totalIGST += Number(item.igst);
    }
  }

  const outputTotal = totalCGST + totalSGST + totalIGST;

  // Estimate input tax credit (assumed 18% GST on all expenses with receipts)
  const expensesWithReceipts = expenses.filter((e) => e.receipt);
  const inputTax = expensesWithReceipts.reduce(
    (sum, e) => sum + Number(e.amount) * 0.18,
    0
  );

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    outputTax: {
      cgst: Math.round(totalCGST * 100) / 100,
      sgst: Math.round(totalSGST * 100) / 100,
      igst: Math.round(totalIGST * 100) / 100,
      total: Math.round(outputTotal * 100) / 100,
    },
    inputTax: Math.round(inputTax * 100) / 100,
    netPayable: Math.round((outputTotal - inputTax) * 100) / 100,
    invoiceCount: invoices.length,
    expenseCount: expensesWithReceipts.length,
  };
}
