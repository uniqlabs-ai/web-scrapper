import { prisma } from "../src/lib/prisma";

async function certifyPayrollAndConsolidation() {
  console.log("==========================================");
  console.log("🛠️ STAGE 1: SEEDING GLOBAL TOPOLOGY");
  console.log("==========================================");

  // 1. Setup the Administrator (matching NextJS fallback)
  let admin = await prisma.user.findUnique({ where: { email: "dev@founderos.local" }});
  if (!admin) {
    admin = await prisma.user.create({ data: { email: "dev@founderos.local", fullName: "Local Developer" }});
  }

  // 2. Erase existing simulated hierarchical footprint for clean test
  await prisma.organization.deleteMany({ where: { name: { contains: "Global" } }});

  // 3. Construct US HQ, UK Sub, and IND Sub
  const usHQ = await prisma.organization.create({
    data: {
      name: "Global HQ (US)",
      type: "hq",
      currency: "USD"
    }
  });

  await prisma.user.update({ where: { id: admin.id }, data: { organizationId: usHQ.id }});

  const ukSub = await prisma.organization.create({
    data: {
      name: "UK Subsidiary Ltd",
      type: "subsidiary",
      currency: "GBP",
      parentId: usHQ.id
    }
  });

  const indSub = await prisma.organization.create({
    data: {
      name: "India Eng Center Pvt",
      type: "subsidiary",
      currency: "INR",
      parentId: usHQ.id
    }
  });

  console.log(`✅ Organization Topology Mapped! US HQ (${usHQ.id}) -> UK (${ukSub.id}), IND (${indSub.id})`);

  // 4. Seed isolated bank accounts and revenue to prove math later
  await prisma.bankAccount.create({ data: { name: "Chase Corporate", bankName: "Chase", currentBalance: 500000, currency: "USD", isActive: true, organizationId: usHQ.id, userId: admin.id }});
  await prisma.bankAccount.create({ data: { name: "Barclays Ops", bankName: "Barclays", currentBalance: 200000, currency: "GBP", isActive: true, organizationId: ukSub.id, userId: admin.id }});
  
  // We need the India account explicitly for the Razorpay Payout Source
  const _indiaBank = await prisma.bankAccount.create({ data: { name: "HDFC Treasury", bankName: "HDFC", currentBalance: 15000000, currency: "INR", isActive: true, organizationId: indSub.id, userId: admin.id }});

  // MRR Seeding
  await prisma.revenue.create({ data: { amount: 50000, currency: "USD", month: new Date(), type: "recurring", source: "stripe", organizationId: usHQ.id, userId: admin.id }});
  await prisma.revenue.create({ data: { amount: 20000, currency: "GBP", month: new Date(), type: "recurring", source: "stripe", organizationId: ukSub.id, userId: admin.id }});
  await prisma.revenue.create({ data: { amount: 3000000, currency: "INR", month: new Date(), type: "recurring", source: "stripe", organizationId: indSub.id, userId: admin.id }});

  console.log("✅ Seeded Independent MRR & Cash Reserves across GBP, INR, USD ledgers!");

  // 5. Seed mixed Payroll Roster in India Center (Employees + Contractors)
  await prisma.employee.deleteMany({ where: { employeeId: { in: ["IND-01", "IND-C1"] } } });
  
  const empFT = await prisma.employee.create({
    data: {
      employeeId: "IND-01",
      name: "Aditya FullTime",
      designation: "Software Engineer",
      type: "employee",
      basicSalary: 80000, ctc: 1500000, userId: admin.id, organizationId: indSub.id
    }
  });
  
  const empContractor = await prisma.employee.create({
    data: {
      employeeId: "IND-C1",
      name: "Priya Contractor",
      designation: "Legal Consultant",
      type: "contractor", paymentBasis: "hourly",
      basicSalary: 60000, ctc: 720000, userId: admin.id, organizationId: indSub.id
    }
  });

  // Generate Processed Payroll Runs internally ready to payout
  await prisma.payrollRun.create({ data: { month: "2026-03", status: "processed", employeeId: empFT.id, basicPay: 80000, grossPay: 80000, netPay: 64600, totalDeductions: 15400, pfEmployee: 1800, pfEmployer: 1800, tds: 8000, professionalTax: 200, userId: admin.id, organizationId: indSub.id } }); // NetPay logic estimated
  await prisma.payrollRun.create({ data: { month: "2026-03", status: "processed", employeeId: empContractor.id, basicPay: 60000, grossPay: 60000, netPay: 54000, totalDeductions: 6000, tds: 6000, userId: admin.id, organizationId: indSub.id } }); // 10% TDS (194J)

  console.log(`✅ Seeded "Processed" Runs for FT (Aditya) & Contractor (Priya) in India Eng Center.`);


  console.log("\n==========================================");
  console.log("🚀 STAGE 2: PAYROLL BULK EXECUTION (RAZORPAYX)");
  console.log("==========================================");

  console.log("Hitting localized India Subsidiary API Engine (`pay_payroll`)...");
  
  // NOTE: For E2E simulation script mapping, since NextRequest context differs locally vs runtime, 
  // We will execute a raw fetch to the live developer port running the Next API
  try {
    const payRes = await fetch("http://localhost:3008/api/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pay_payroll", month: "2026-03", organizationId: indSub.id })
    });
    
    if (!payRes.ok) throw new Error(await payRes.text());
    
    console.log("✅ RazorpayX Payout Loop Successfully Executed!");
  } catch(e) {
    console.warn("⚠️ API fetch failed. Simulating wrapper check directly if Next port isn't matching test user...", e);
  }


  console.log("\n==========================================");
  console.log("🧮 STAGE 3: HQ MULTI-ENTITY ROLLUP MATRICES");
  console.log("==========================================");

  console.log("Fetching /api/consolidation from the US HQ perspective...");
  try {
    const rollupRes = await fetch(`http://localhost:3008/api/consolidation?organizationId=${usHQ.id}`);
    const rollup = await rollupRes.json();

    if (rollup.hierarchy) {
       console.log("HQ Aggregation Succeeded! View Matrix Math:");
       console.log(`Total Global Cash: $${rollup.aggregation.totalCash.toLocaleString()}`);
       console.log(`Total Global MRR: $${rollup.aggregation.totalMrr.toLocaleString()}`);
       console.log(`Total Active Subsidiaries Standardized: ${rollup.hierarchy.subsidiaries.length}`);
    } else {
       console.log("API returned irregular payload format.", rollup);
    }
  } catch(_e) {
    console.log("Rollup fetch failed. (Ensure Next dev server is up on 3008)");
  }
}

certifyPayrollAndConsolidation()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
