import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

export async function GET(_request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    
    // Config: Analyze last 12 months
    const now = new Date();
    // Start of current month
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // 1. Fetch all recurring revenue
    const revenues = await prisma.revenue.findMany({
      take: 10000,
      where: { 
        userId,
        organizationId,
        type: "recurring",
        month: { gte: twelveMonthsAgo }
      },
    });

    // 2. Fetch marketing expenses (CAC proxy)
    const expenses = await prisma.expense.findMany({
      take: 10000,
      where: {
        userId,
        organizationId,
        date: { gte: twelveMonthsAgo },
        category: { name: { contains: "Market" } } // "Marketing"
      },
      include: { category: true },
    });

    // 3. Fetch Clients (New Customer Acq)
    const clients = await prisma.client.findMany({
      take: 10000,
      where: {
        userId,
        organizationId,
        createdAt: { gte: twelveMonthsAgo }
      },
    });

    // Grouping by Month
    const monthsData: Record<string, { mrr: number, cacSpend: number, newClients: number }> = {};
    
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7); // YYYY-MM
        monthsData[key] = { mrr: 0, cacSpend: 0, newClients: 0 };
    }

    // Populate MRR
    for (const r of revenues) {
        const key = r.month.toISOString().slice(0, 7);
        if (monthsData[key]) monthsData[key].mrr += Number(r.amount);
    }

    // Populate CAC Spend
    for (const e of expenses) {
        const key = e.date.toISOString().slice(0, 7);
        if (monthsData[key]) monthsData[key].cacSpend += Number(e.amount);
    }

    // Populate New Clients
    for (const c of clients) {
        const key = c.createdAt.toISOString().slice(0, 7);
        if (monthsData[key]) monthsData[key].newClients += 1;
    }

    // Convert to Array
    const trends = Object.keys(monthsData).sort().map(month => {
       const m = monthsData[month];
       const cac = m.newClients > 0 ? (m.cacSpend / m.newClients) : 0;
       return {
           month,
           mrr: m.mrr,
           cacSpend: m.cacSpend,
           newClients: m.newClients,
           cac
       };
    });

    // Calculate current stats (Last plotted month = current month)
    const currentMonthKey = thisMonthStart.toISOString().slice(0, 7);
    const lastMonthKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    
    const currentMRR = monthsData[currentMonthKey]?.mrr || 0;
    const previousMRR = monthsData[lastMonthKey]?.mrr || 0;
    const mrrGrowth = previousMRR > 0 ? ((currentMRR - previousMRR) / previousMRR) * 100 : 0;

    const currentARR = currentMRR * 12;

    const currentCACSpend = monthsData[currentMonthKey]?.cacSpend || 0;
    const currentNewClients = monthsData[currentMonthKey]?.newClients || 0;
    const currentCAC = currentNewClients > 0 ? currentCACSpend / currentNewClients : 0;

    // Estimate LTV (ARPU / Churn Rate). Assume industry 3% churn if no better data.
    const activeClients = await prisma.client.count({ where: { userId, organizationId } });
    const currentARPU = activeClients > 0 ? currentMRR / activeClients : 0;
    const estimatedChurn = 0.03; 
    const estimatedLTV = currentARPU / estimatedChurn;
    
    const ltvCacRatio = currentCAC > 0 ? (estimatedLTV / currentCAC) : 0;

    // AI/Auto generate insight texts
    const alerts: string[] = [];
    if (ltvCacRatio >= 3) {
      alerts.push(`🔥 Healthy Growth! LTV:CAC Ratio is ${ltvCacRatio.toFixed(1)}x (>3x benchmark).`);
    } else if (ltvCacRatio > 0 && ltvCacRatio < 1) {
      alerts.push(`⚠️ WARNING: Critical LTV:CAC Ratio (${ltvCacRatio.toFixed(1)}x). You are losing money on acquisition.`);
    }

    if (mrrGrowth > 10) {
      alerts.push(`🚀 MRR grew by ${mrrGrowth.toFixed(1)}% this month.`);
    }

    return NextResponse.json({
      metrics: {
        mrr: currentMRR,
        arr: currentARR,
        mrrGrowth,
        cac: currentCAC,
        ltv: estimatedLTV,
        ltvCacRatio,
        arpu: currentARPU,
        activeClients
      },
      trends,
      alerts
    });
  } catch (error) {
    log.error("SaaS Metrics error", { module: "metrics", action: "saas", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to generate SaaS metrics" }, { status: 500 });
  }
}
