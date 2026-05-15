async function testAllEndpoints() {
  const BASE_URL = "http://localhost:3008";
  
  const endpoints = [
    "/api/dashboard",
    "/api/health",
    "/api/clients",
    "/api/invoices",
    "/api/bank/transactions",
    "/api/payroll",
    "/api/metrics/saas",
    "/api/vendors",
    "/api/tds",
    "/api/ap-inbox",
    "/api/expenses",
    "/api/accounting/trial-balance",
    "/api/budgets",
    "/api/consolidation"
  ];

  console.log("==================================================");
  console.log("🔥 INITIATING COMPREHENSIVE E2E APP HEARTBEAT TEST");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    process.stdout.write(`Ping GET ${endpoint.padEnd(30)} `);
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`);
      if (res.ok) {
        process.stdout.write(`✅ 200 OK (${res.statusText})\n`);
        passed++;
      } else {
        process.stdout.write(`❌ ${res.status} ERR (${res.statusText})\n`);
        const text = await res.text();
        failures.push(`${endpoint} returned ${res.status}: ${text.substring(0, 100)}`);
        failed++;
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      process.stdout.write(`🧨 CRASH (${err.message || String(err)})\n`);
      failures.push(`${endpoint} completely failed: ${err.message || String(err)}`);
      failed++;
    }
  }

  console.log("==================================================");
  console.log(`🎯 AUDIT COMPLETE. PASSED: ${passed} | FAILED: ${failed}`);
  
  if (failed > 0) {
    console.log("\n⚠️ ERROR TRACES:");
    failures.forEach(f => console.log(f));
    process.exit(1);
  } else {
    console.log("\n🚀 SYSTEM IS STABLE! 100% Uptime across all matrices.");
    process.exit(0);
  }
}

testAllEndpoints().catch(console.error);
