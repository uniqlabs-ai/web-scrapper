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

  const org = await prisma.organization.findFirst({ where: { users: { some: { id: userId } } } });
  const organizationId = org?.id || "";

  const runway = await getRunway(userId, organizationId);
  const burnRate = await getBurnRate(userId, organizationId);
  const revenue = await getRevenueData(userId, organizationId);

  console.log("--- Dashboard KPIs ---");
  console.log("Runway:", runway);
  console.log("Burn Rate:", burnRate);
  console.log("Revenue:", revenue);

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);


  const pnl = await generatePnL(userId, organizationId, from, to);
  console.log("\n--- P&L ---");
  console.log(pnl);

  const cashflow = await projectCashFlow(userId, organizationId, 6);
  console.log("\n--- Cashflow ---");
  console.log(cashflow.projections.slice(0, 2)); // show first 2
}
main().catch(console.error).finally(() => prisma.$disconnect());
