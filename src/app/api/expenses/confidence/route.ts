import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

// GET: Categorization confidence analytics
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    const transactions = await prisma.bankTransaction.findMany({
      take: 500,
      where: { userId },
      select: { confidence: true, category: true, isReconciled: true },
    });

    const total = transactions.length;
    const withCategory = transactions.filter((t) => t.category).length;
    const withConfidence = transactions.filter((t) => t.confidence !== null);
    
    const avgConfidence = withConfidence.length > 0
      ? withConfidence.reduce((s, t) => s + Number(t.confidence), 0) / withConfidence.length
      : 0;

    // Confidence buckets
    const highConf = withConfidence.filter((t) => Number(t.confidence) >= 0.9).length;
    const medConf = withConfidence.filter((t) => Number(t.confidence) >= 0.7 && Number(t.confidence) < 0.9).length;
    const lowConf = withConfidence.filter((t) => Number(t.confidence) < 0.7).length;
    
    const uncategorized = transactions.filter((t) => !t.category).length;
    const reconciled = transactions.filter((t) => t.isReconciled).length;
    const categorizationRate = total > 0 ? (withCategory / total) * 100 : 0;
    const reconciliationRate = total > 0 ? (reconciled / total) * 100 : 0;

    return NextResponse.json({
      total,
      categorized: withCategory,
      uncategorized,
      categorizationRate: Math.round(categorizationRate * 10) / 10,
      avgConfidence: Math.round(avgConfidence * 100),
      highConfidence: highConf,
      mediumConfidence: medConf,
      lowConfidence: lowConf,
      reconciled,
      reconciliationRate: Math.round(reconciliationRate * 10) / 10,
    });
  } catch (error) {
    log.error("Confidence stats error", { module: "expenses", action: "confidence", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
