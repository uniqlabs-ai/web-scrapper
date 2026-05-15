import { prisma } from "../src/lib/prisma";

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("No user found.");
    return;
  }

  const category = await prisma.expenseCategory.findFirst({
    where: { userId: user.id }
  });

  const now = new Date();

  // Seed 1: Triplicate identical expenses to trigger duplicates
  for (let i = 0; i < 3; i++) {
    await prisma.expense.create({
      data: {
        description: "Figma Annual Sub",
        amount: 8500,
        vendor: "Figma",
        date: now,
        userId: user.id,
        categoryId: category?.id,
        organizationId: user.organizationId,
      }
    });
  }

  // Seed 2: Spiking an expense to trigger trailing average spike
  await prisma.expense.create({
    data: {
      description: "Massive AWS Bill",
      amount: 150000,
      vendor: "Amazon Web Services",
      date: now,
      userId: user.id,
      categoryId: category?.id,
      organizationId: user.organizationId,
    }
  });

  console.log("Seeded anomaly data for AI Auditor successfully!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
