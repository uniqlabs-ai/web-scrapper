import { prisma } from "./prisma";
import type { RunwayData, BurnRateData, RevenueData } from "./types";

export async function getRunway(userId: string): Promise<RunwayData> {
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { userId, isActive: true },
    take: 100, // RELIABILITY: Safety ceiling
  });
  const cashInBank = bankAccounts.reduce(
    (sum, a) => sum + Number(a.currentBalance),
    0
  );

  const monthlyBurn = await getMonthlyBurn(userId);
  const runwayMonths =
    monthlyBurn > 0 ? Math.round((cashInBank / monthlyBurn) * 10) / 10 : Infinity;

  const projectedRunOutDate =
    runwayMonths !== Infinity
      ? new Date(
        Date.now() + runwayMonths * 30 * 24 * 60 * 60 * 1000
      ).toISOString()
      : null;

  return { cashInBank, monthlyBurn, runwayMonths, projectedRunOutDate };
}

export async function getBurnRate(userId: string): Promise<BurnRateData> {
  const now = new Date();

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

  const [currentExpenses, prevExpenses, threeMonthExpenses] = await Promise.all([
    prisma.expense.aggregate({
      where: { userId, date: { gte: currentMonthStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        userId,
        date: { gte: prevMonthStart, lt: currentMonthStart },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: threeMonthsAgo } },
      _sum: { amount: true },
    }),
  ]);

  const currentMonth = Number(currentExpenses._sum.amount ?? 0);
  const previousMonth = Number(prevExpenses._sum.amount ?? 0);
  const average3Month =
    Math.round((Number(threeMonthExpenses._sum.amount ?? 0) / 3) * 100) / 100;

  let trend: BurnRateData["trend"] = "stable";
  if (previousMonth > 0) {
    if (currentMonth > previousMonth * 1.1) trend = "increasing";
    else if (currentMonth < previousMonth * 0.9) trend = "decreasing";
  }

  return { currentMonth, previousMonth, average3Month, trend };
}

export async function getRevenueData(userId: string): Promise<RevenueData> {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const revenues = await prisma.revenue.findMany({
    where: { userId, month: { gte: sixMonthsAgo } },
    orderBy: { month: "asc" },
    take: 5000, // RELIABILITY: Safety ceiling
  });

  const history = revenues.map((r) => ({
    month: r.month.toISOString().slice(0, 7),
    amount: Number(r.amount),
  }));

  // Aggregate history by month for the chart
  const historyByMonth: Record<string, number> = {};
  for (const h of history) {
    historyByMonth[h.month] = (historyByMonth[h.month] || 0) + h.amount;
  }
  const aggregatedHistory = Object.entries(historyByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

  const currentMonthRevenues = revenues.filter(
    (r) => r.month >= currentMonthStart
  );
  const prevMonthRevenues = revenues.filter(
    (r) => r.month >= prevMonthStart && r.month < currentMonthStart
  );

  // Total monthly revenue (all types) for the current month
  const totalMonthlyRevenue = currentMonthRevenues.reduce(
    (sum, r) => sum + Number(r.amount), 0
  );

  // MRR = only recurring revenue
  const currentMRR = currentMonthRevenues
    .filter((r) => r.type === "recurring")
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const previousMRR = prevMonthRevenues
    .filter((r) => r.type === "recurring")
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const currentARR = currentMRR * 12;
  const growth =
    previousMRR > 0
      ? Math.round(((currentMRR - previousMRR) / previousMRR) * 100 * 10) / 10
      : 0;

  return { currentMRR, currentARR, previousMRR, growth, history: aggregatedHistory, totalMonthlyRevenue };
}

async function getMonthlyBurn(userId: string): Promise<number> {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const expenses = await prisma.expense.aggregate({
    where: { userId, date: { gte: threeMonthsAgo } },
    _sum: { amount: true },
  });

  return Math.round((Number(expenses._sum.amount ?? 0) / 3) * 100) / 100;
}
