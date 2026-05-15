import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Simulating inbound Resend email webhook...");

  // Mock 1x1 transparent Base64 image
  const dummyImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  const _payload = {
    from: "vendor-billing@supabase.com",
    subject: "Supabase Invoice - March 2026",
    attachments: [
      {
        filename: "invoice_mar2026.png",
        content_type: "image/png",
        content: dummyImage,
      }
    ]
  };

  // 1. We will use fetch against the local next.js server or we can just mock the webhook by directly calling the POST handler.
  // Actually, since we want to test E2E, we'll hit the localhost API endpoint directly if it is running, OR we can just inject into DB directly for the seed. Let's just inject into DB directly since Next.js might not be running.
  
  const adminUser = await prisma.user.findFirst({ where: { role: "admin" } });
  if (!adminUser) throw new Error("No admin user found to seed into");

  const userId = adminUser.id;
  const orgId = adminUser.organizationId;

  // Mock Gemini Response that webhook would normally generate
  const extracted = {
    amount: 2500,
    vendor: "Supabase Inc.",
    date: new Date().toISOString(),
    gstNumber: null,
    category: "Software",
    description: "Database Hosting & Auth",
    currency: "INR",
    confidence: 0.98,
  };

  const receipt = await prisma.receipt.create({
    data: {
      fileName: "invoice_mar2026.png",
      mimeType: "image/png",
      imageData: dummyImage,
      status: "processed",
      confidence: 0.98,
      extractedData: JSON.stringify(extracted),
      extractedAmount: 2500,
      extractedVendor: "Supabase Inc.",
      extractedDate: new Date(),
      extractedCategory: "Software",
      userId,
    },
  });

  const expense = await prisma.expense.create({
    data: {
      description: "Database Hosting & Auth",
      amount: 2500,
      currency: "INR",
      date: new Date(),
      vendor: "Supabase Inc.",
      source: "email_inbox",
      sourceId: receipt.id,
      userId,
      organizationId: orgId,
    }
  });

  await prisma.receipt.update({
    where: { id: receipt.id },
    data: { expenseId: expense.id }
  });

  await prisma.expenseApproval.create({
    data: {
      status: "pending",
      comments: "Received via Email from vendor-billing@supabase.com",
      expenseId: expense.id,
      approverId: userId,
    }
  });

  console.log(`Successfully seeded A/P Inbox entry from Supabase Inc. for INR 2,500!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
