import { prisma } from "@/lib/prisma";

export interface AnomalyAlert {
  id: string;
  type: "warning" | "danger" | "info";
  title: string;
  message: string;
  action: string;
  actionUrl: string;
}

export async function detectAnomalies(userId: string): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];
  const now = new Date();
  
  // 30 days boundary
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  // 1. Detect Duplicate Expenses in the last 30 days
  const recentExpenses = await prisma.expense.findMany({
    where: { userId, date: { gte: thirtyDaysAgo } },
    include: { vendorEntity: true, category: true },
    orderBy: { date: "desc" },
    take: 2000, // RELIABILITY: Safety ceiling
  });

  const dupesMap = new Map<string, number>();
  let duplicateCount = 0;
  let totalDupeValue = 0;

  for (const exp of recentExpenses) {
    // Generate a fingerprint hash for collision detection
    const vendorName = exp.vendorEntity?.name ?? exp.vendor ?? "unknown";
    const amountKey = Number(exp.amount).toFixed(2);
    // Ignore small expenses under 100
    if (Number(exp.amount) < 100) continue;

    const key = `${vendorName}-${amountKey}-${exp.date.toISOString().slice(0, 10)}`;
    const count = dupesMap.get(key) || 0;
    
    if (count === 1) {
      // It's the second time we see this exact combo
      duplicateCount++;
      totalDupeValue += Number(exp.amount);
    }
    dupesMap.set(key, count + 1);
  }

  if (duplicateCount > 0) {
    alerts.push({
      id: "ai-duplicate-expenses",
      type: "warning",
      title: "Duplicate Expenses Detected",
      message: `AI detected ${duplicateCount} potential duplicate expense(s) costing ₹${totalDupeValue.toLocaleString("en-IN")}.`,
      action: "Review Expenses",
      actionUrl: "/expenses?filter=duplicates",
    });
  }

  // 2. Detect Category Spikes (Current Month vs Trailing 3 Months)
  const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfThreeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const historicalExpenses = await prisma.expense.findMany({
    where: { 
      userId, 
      date: { gte: firstOfThreeMonthsAgo, lt: firstOfCurrent }
    },
    include: { category: true },
    take: 5000, // RELIABILITY: Safety ceiling
  });

  const currentExpenses = recentExpenses.filter(e => e.date >= firstOfCurrent);

  // Group historical by category
  const historicalByCat = new Map<string, number>();
  for (const exp of historicalExpenses) {
    const cat = exp.category?.name ?? "Uncategorized";
    historicalByCat.set(cat, (historicalByCat.get(cat) || 0) + Number(exp.amount));
  }

  // Group current by category
  const currentByCat = new Map<string, number>();
  for (const exp of currentExpenses) {
    const cat = exp.category?.name ?? "Uncategorized";
    currentByCat.set(cat, (currentByCat.get(cat) || 0) + Number(exp.amount));
  }

  for (const [cat, currentSum] of Array.from(currentByCat.entries())) {
    const pastSum = historicalByCat.get(cat) || 0;
    const avgPast = pastSum / 2; // Average of the 2 prior months
    
    // If the category average was at least 5000 and current is spiking by > 40%
    if (avgPast > 5000 && currentSum > avgPast * 1.4) {
      const spikePct = Math.round(((currentSum - avgPast) / avgPast) * 100);
      alerts.push({
        id: `ai-spike-${cat}`,
        type: "danger",
        title: `Spend Spike: ${cat}`,
        message: `Your ${cat} spend is up ${spikePct}% (₹${currentSum.toLocaleString("en-IN")}) compared to historical averages.`,
        action: "Analyze Spend",
        actionUrl: "/expenses",
      });
    }
  }

  return alerts;
}
