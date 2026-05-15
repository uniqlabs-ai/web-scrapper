import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Seeding 12 Months of Virtual CFO Data...");

  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("No admin user found to seed into");
  
  const userId = admin.id;

  // Clear previous demo seeded data (optional, skipping so we can just add more)
  
  const now = new Date();
  const startMRR = 150000; // ₹1.5L MRR
  const baseUrlCacSpend = 50000; // ₹50k marketing spend 

  // Marketing Category
  let mktgCat = await prisma.expenseCategory.findFirst({ where: { name: "Marketing", userId }});
  if (!mktgCat) {
     mktgCat = await prisma.expenseCategory.create({ data: { name: "Marketing", userId, organizationId: admin.organizationId }});
  }

  // Pre-seed 12 months
  for (let i = 11; i >= 0; i--) {
    const monthBase = new Date(now.getFullYear(), now.getMonth() - i, 1);
    
    // Growth scaling: Growth is compound over 11 months (+10% per month roughly)
    const factor = Math.pow(1.10, 11 - i);

    const mrr = startMRR * factor;
    const cacSpend = baseUrlCacSpend * Math.max(0.8, (factor * 0.9)); // Spends less efficiently over time
    
    // 1. Log MRR
    await prisma.revenue.create({
      data: {
         month: monthBase,
         amount: Math.round(mrr),
         currency: "INR",
         type: "recurring",
         source: "stripe_sync",
         userId,
         organizationId: admin.organizationId
      }
    });

    // 2. Log Marketing Expense
    await prisma.expense.create({
      data: {
         description: "Google Ads & Meta",
         amount: Math.round(cacSpend),
         currency: "INR",
         date: new Date(monthBase.getTime() + 86400000 * 5), // 5th of month
         vendor: "Google LLC",
         categoryId: mktgCat.id,
         source: "bank_sync",
         userId,
         organizationId: admin.organizationId
      }
    });

    // 3. Log Clients acquired
    // Assuming ARPU of ₹10,000, new clients = (mrr difference) / 10000. Let's just mock 3 to 10 clients.
    const newClients = Math.floor(Math.random() * 5 * factor) + 5; 
    
    for (let c = 0; c < newClients; c++) {
       await prisma.client.create({
         data: {
           name: `Stripe Sync Customer ${Date.now()}-${c}`,
           email: `customer${c}@demo.com`,
           createdAt: monthBase,
           userId,
           organizationId: admin.organizationId
         }
       });
    }
  }

  console.log("Virtual CFO SaaS Seeding Complete! Load /saas-metrics!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
