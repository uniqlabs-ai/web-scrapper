import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { convertToINR, convertFromINR } from "@/lib/currency";
import { log, toLogError } from "@/lib/logger";

function toBaseCurr(amount: number, localCurr: string, baseCurr: string) {
  const inrVal = convertToINR(amount, localCurr);
  return convertFromINR(inrVal, baseCurr);
}

export async function GET(_request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: {
          include: { subsidiaries: true }
        }
      }
    });

    if (!user || !user.organization) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    const hq = user.organization;
    const baseCurr = hq.currency || "INR";

    // Even if they aren't marked as 'hq', we render their own data in the unified context.
    // If they have subsidiaries, we include them too.
    const allEntities = [hq, ...hq.subsidiaries];
    const orgIds = allEntities.map(o => o.id);

    // Fetch unified ledger metrics
    const [bankAccounts, expenses, revenues, invoices] = await Promise.all([
       prisma.bankAccount.findMany({ where: { organizationId: { in: orgIds }, isActive: true }, take: 500 }),
       prisma.expense.findMany({ where: { organizationId: { in: orgIds } }, include: { vendorEntity: true }, take: 500 }),
       prisma.revenue.findMany({ where: { organizationId: { in: orgIds } }, include: { client: true }, take: 500 }),
       prisma.invoice.findMany({ where: { organizationId: { in: orgIds }, status: { not: "paid" } }, include: { client: true }, take: 500 }),
    ]);

    // Create a Set for inter-company eliminations based on exact entity names
    const entityNames = new Set(allEntities.map(e => e.name.toLowerCase()));

    // Compute Globals
    let globalCash = 0;
    let globalMRR = 0;
    let globalBurn = 0;
    let globalReceivables = 0;
    let eliminatedMrr = 0;
    let eliminatedBurn = 0;

    // By-Entity Breakdown
    const entityRollups: Record<string, { id: string, name: string, type: string, localCurrency: string, cash: number, mrr: number, burn: number, receivables: number, baseCash: number, baseMrr: number }> = {};
    
    for (const org of allEntities) {
       entityRollups[org.id] = { id: org.id, name: org.name, type: org.type, localCurrency: org.currency, cash: 0, mrr: 0, burn: 0, receivables: 0, baseCash: 0, baseMrr: 0 };
    }

    // 1. Rollup Cash
    for (const b of bankAccounts) {
       if (!b.organizationId) continue;
       const val = Number(b.currentBalance);
       entityRollups[b.organizationId].cash += val;
       
       const baseVal = toBaseCurr(val, b.currency, baseCurr);
       entityRollups[b.organizationId].baseCash += baseVal;
       globalCash += baseVal;
    }

    // 2. Rollup MRR (Just this month for simplicity of realtime view)
    const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    for (const r of revenues) {
       if (!r.organizationId || r.type !== "recurring" || r.month < thisMonthStart) continue;
       const val = Number(r.amount);
       const baseVal = toBaseCurr(val, r.currency, baseCurr);
       
       entityRollups[r.organizationId].mrr += val;
       entityRollups[r.organizationId].baseMrr += baseVal;
       
       if (r.client && r.client.name && entityNames.has(r.client.name.toLowerCase())) {
           eliminatedMrr += baseVal;
       } else {
           globalMRR += baseVal;
       }
    }

    // 3. Rollup Burn (MTD expenses)
    for (const e of expenses) {
       if (!e.organizationId || e.date < thisMonthStart) continue;
       const val = Number(e.amount);
       const baseVal = toBaseCurr(val, e.currency, baseCurr);
       
       entityRollups[e.organizationId].burn += val;
       
       if (e.vendorEntity && e.vendorEntity.name && entityNames.has(e.vendorEntity.name.toLowerCase())) {
           eliminatedBurn += baseVal;
       } else {
           globalBurn += baseVal;
       }
    }

    // 4. Rollup Receivables (Outstanding)
    for (const i of invoices) {
       if (!i.organizationId || i.status === "cancelled") continue;
       const val = Number(i.total);
       entityRollups[i.organizationId].receivables += val;
       const baseVal = toBaseCurr(val, i.currency, baseCurr);
       globalReceivables += baseVal;
    }

    return NextResponse.json({
        hq: {
           id: hq.id,
           name: hq.name,
           baseCurrency: baseCurr,
           type: hq.type
        },
        global: {
           totalCash: globalCash,
           mrr: globalMRR,
           mtdBurn: globalBurn,
           receivables: globalReceivables,
           netRunRate: globalMRR - globalBurn,
           eliminations: {
             mrr: eliminatedMrr,
             burn: eliminatedBurn
           }
        },
        subsidiaries: Object.values(entityRollups).sort((_a,_b) => _a.type === 'hq' ? -1 : 1) // HQ first
    });

  } catch (error) {
    log.error("Consolidation error", { module: "consolidation", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to generate rollup" }, { status: 500 });
  }
}
