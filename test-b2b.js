const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const http = require('http');

async function runTests() {
  console.log("=== B2B SaaS Integration Tests ===");

  try {
    // 1. Get the primary org (ensure we have one)
    let org = await prisma.organization.findFirst();
    if (!org) {
       console.log("No organization found, run the app once to let middleware create a demo user/org");
       return;
    }
    console.log(`✅ Organization identified: ${org.id}`);

    // 2. Setup Webhook Receiver (Local Server)
    const webhookEvents = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        webhookEvents.push({
          event: req.headers['x-finance-event'],
          body: JSON.parse(body)
        });
        res.writeHead(200);
        res.end('OK');
      });
    });
    server.listen(4005);
    console.log(`✅ Local Webhook Receiver running on port 4005`);

    // 3. Register Webhook and API Key in DB
    await prisma.webhook.deleteMany({ where: { organizationId: org.id, url: "http://localhost:4005" }});
    await prisma.apiKey.deleteMany({ where: { organizationId: org.id, name: "Test API Key" }});

    const apiKey = await prisma.apiKey.create({
      data: {
        name: "Test API Key",
        keyHash: "test_sk_12345",
        organizationId: org.id
      }
    });

    const _webhook = await prisma.webhook.create({
      data: {
        url: "http://localhost:4005",
        events: '["invoice.created", "expense.created"]',
        secret: "test_secret",
        organizationId: org.id
      }
    });
    console.log(`✅ API Key & Webhook provisioned`);

    // 4. Test API Payload (Simulate External CRM pushing an invoice)
    console.log(`⏳ Testing POST /api/v1/invoices...`);
    const invoiceRes = await fetch("http://localhost:3008/api/v1/invoices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.keyHash}`
      },
      body: JSON.stringify({
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        notes: "API Integration Test Invoice",
        lineItems: [
          { description: "SaaS API Usage", quantity: 1, unitPrice: 5000, gstRate: 18 }
        ]
      })
    });
    
    const invoiceData = await invoiceRes.json();
    if (invoiceRes.ok) {
       console.log(`✅ Invoice API Success: Created ${invoiceData.invoice.invoiceNumber}`);
    } else {
       console.log(`❌ Invoice API Failed:`, invoiceData);
    }

    // Wait a second for webhook to arrive
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 5. Verify Webhook Receipt
    if (webhookEvents.length > 0) {
      console.log(`✅ Webhook Delivered: Received ${webhookEvents[0].event} event successfully`);
    } else {
      console.log(`❌ Webhook Failed: No events received payload`);
    }

    // Cleanup
    server.close();
    await prisma.$disconnect();

  } catch(e) {
    console.error("Test failed:", e);
  }
}

runTests();
