import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Seeding Multi-Entity Global Corporate Structure...");

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, include: { organization: true } });
  if (!admin || !admin.organization) throw new Error("No admin organization found.");

  const hq = admin.organization;
  const userId = admin.id;

  // Make the current Org the HQ (Parent)
  await prisma.organization.update({
    where: { id: hq.id },
    data: {
      type: "hq",
      name: "Founder OS (Global HQ)",
      currency: "USD" // Convert HQ to USD base logic for demonstration
    }
  });

  // Create UK Subsidiary
  const ukSub = await prisma.organization.create({
    data: {
      name: "Founder OS UK Ltd.",
      currency: "GBP",
      type: "subsidiary",
      parentId: hq.id
    }
  });

  // Create India Subsidiary
  const inSub = await prisma.organization.create({
    data: {
      name: "Founder OS India Pvt Ltd.",
      currency: "INR",
      type: "subsidiary",
      parentId: hq.id
    }
  });

  const now = new Date();

  // Populate UK Subsidiary Ledger (GBP)
  await prisma.bankAccount.create({
     data: {
       name: "HSBC UK Ops",
       bankName: "HSBC",
       currency: "GBP",
       currentBalance: 85000,
       isActive: true,
       userId,
       organizationId: ukSub.id
     }
  });
  
  await prisma.revenue.create({
      data: {
         month: now,
         amount: 15000,
         currency: "GBP",
         type: "recurring",
         userId,
         organizationId: ukSub.id
      }
  });

  await prisma.expense.create({
     data: {
        description: "London WeWork Rent",
        amount: 2500,
        currency: "GBP",
        date: now,
        userId,
        organizationId: ukSub.id
     }
  });

  // Populate India Subsidiary Ledger (INR)
  await prisma.bankAccount.create({
     data: {
       name: "HDFC Pvt Ltd",
       bankName: "HDFC",
       currency: "INR",
       currentBalance: 4500000, // 45 Lakhs
       isActive: true,
       userId,
       organizationId: inSub.id
     }
  });

  await prisma.revenue.create({
      data: {
         month: now,
         amount: 800000,
         currency: "INR",
         type: "recurring",
         userId,
         organizationId: inSub.id
      }
  });

  await prisma.expense.create({
      data: {
         description: "Bangalore Dev Team Salaries",
         amount: 600000,
         currency: "INR",
         date: now,
         userId,
         organizationId: inSub.id
      }
  });

  // HQ US Ledger (USD)
  await prisma.bankAccount.create({
     data: {
       name: "Mercury HQ",
       bankName: "Mercury",
       currency: "USD",
       currentBalance: 250000, // $250k
       isActive: true,
       userId,
       organizationId: hq.id
     }
  });

  console.log("Global Entity Infrastructure Seeded: HQ (USD), UK (GBP), India (INR). Check /consolidation for the Rollup view!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
