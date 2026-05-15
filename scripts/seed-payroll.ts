import { prisma } from "../src/lib/prisma";

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found");

  // Create Contractor
  const contractor = await prisma.employee.create({
    data: {
      employeeId: `CON-${Date.now().toString().slice(-4)}`,
      name: "Tesseract Freelance Engineers",
      designation: "Senior Engineer",
      basicSalary: 85000,
      ctc: 85000 * 12,
      type: "contractor",
      userId: user.id,
      organizationId: user.organizationId,
    }
  });

  console.log(`Created Contractor: ${contractor.name}`);

  // We'll create a single PayrollRun directly using the logic from the API
  const gross = 85000;
  // It's an engineer, so 194J(b) -> 10%
  const tds = gross * 0.1;
  const netPay = gross - tds;

  const now = new Date();
  // Set month to current
  const monthStr = now.toISOString().slice(0, 7); // e.g., '2026-03'

  const _run = await prisma.payrollRun.create({
    data: {
      month: monthStr,
      status: "processed", // Ready to be paid by the new Direct Deposit button!
      employeeId: contractor.id,
      basicPay: gross,
      grossPay: gross,
      totalDeductions: tds,
      tds: tds,
      netPay: netPay,
      userId: user.id,
      organizationId: user.organizationId,
    }
  });

  console.log(`Payroll Processed for ${monthStr}. Go to Payroll UI to trigger Direct Deposit and verify TDS dashboard!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
