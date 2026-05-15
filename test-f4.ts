import { prisma } from "./src/lib/prisma";
import { getRunway, getBurnRate, getRevenueData } from "./src/lib/runway";
import { generatePnL, projectCashFlow } from "./src/lib/financial-intelligence";

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("No user found");
    return;
  }
  const userId = user.id;

  const runway = await getRunway(userId);
  const burnRate = await getBurnRate(userId);
  const revenue = await getRevenueData(userId);

  console.log("--- Dashboard KPIs ---");
  console.log("Runway:", runway);
  console.log("Burn Rate:", burnRate);
  console.log("Revenue:", revenue);

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const org = await prisma.organization.findFirst({ where: { users: { some: { id: userId } } } });
  const organizationId = org?.id || "";

  const pnl = await generatePnL(userId, organizationId, from, to);
  console.log("\n--- P&L ---");
  console.log(pnl);

  const cashflow = await projectCashFlow(userId, organizationId, 6);
  console.log("\n--- Cashflow ---");
  console.log(cashflow.projections.slice(0, 2)); // show first 2
}
main().catch(console.error).finally(() => prisma.$disconnect());
