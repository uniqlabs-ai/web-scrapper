import { prisma } from "../src/lib/prisma";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const INVOICES = [
  "925010027324580.pdf",
  "Original Invoice (Jan-Feb) (1).pdf",
  "Invoice (January) - Services Invoice (1)_260303_151140.pdf",
  "Invoice_Joveo_Mar2025.pdf"
];

const STATEMENT_CSV = "DetailedStatement_FY26.csv";

const OCR_PROMPT = `You are an AI AP Inbox system performing OCR. Analyze this invoice/receipt image and extract structured data.

Return ONLY a JSON object with these fields (use null for any field you cannot extract):
{
  "amount": <number, total amount>,
  "vendor": "<string, store/company name>",
  "date": "<string, ISO date format YYYY-MM-DD>",
  "gstNumber": "<string, GSTIN if visible>",
  "category": "<string, one of: Software, Marketing, Rent, Professional Services, Miscellaneous>",
  "description": "<string, brief description of the purchase>",
  "currency": "<string, ISO currency code, default INR>",
  "confidence": <number, 0.0-1.0 your confidence in the extraction>
}

Rules:
- Extract amounts WITHOUT currency symbols
- Return ONLY valid JSON, no markdown or explanation`;

async function ingestStatement(adminId: string, orgId: string) {
  console.log(`[1] Ingesting Bank Statement: ${STATEMENT_CSV}`);
  const csvPath = path.join(process.cwd(), STATEMENT_CSV);
  
  if (!fs.existsSync(csvPath)) {
    console.log("⚠️ Statement CSV not found, skipping.");
    return;
  }

  const bankAccount = await prisma.bankAccount.findFirst({
    where: { userId: adminId, isActive: true },
    orderBy: { currentBalance: "desc" }
  });

  if (!bankAccount) throw new Error("No active bank account to sync to.");

  const lines = fs.readFileSync(csvPath, "utf-8").split("\n").slice(1);
  let trxnCount = 0;
  let revenueCount = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    // Handle basic CSV splitting
    // Format: Date,Description,Withdrawal (Dr),Deposit (Cr),Balance,Type,Reference
    const cols = line.split(",");
    if (cols.length < 6) continue;
    
    const dateRaw = cols[0];
    const desc = cols[1];
    
    // DD/MM/YYYY to YYYY-MM-DD
    const [dd, mm, yyyy] = dateRaw.split("/");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    const withdrawal = parseFloat(cols[2]);
    const deposit = parseFloat(cols[3]);
    const isCredit = cols[5]?.toLowerCase().includes("credit");
    
    const amount = isCredit ? (isNaN(deposit) ? 0 : deposit) : (isNaN(withdrawal) ? 0 : withdrawal);
    if (amount === 0) continue;

    await prisma.bankTransaction.create({
      data: {
        date: new Date(isoDate),
        description: desc,
        amount: amount,
        type: isCredit ? "credit" : "debit",
        category: "Bank Sync",
        source: "import",
        isReconciled: true,
        bankAccountId: bankAccount.id,
        userId: adminId
      }
    });
    trxnCount++;

    if (isCredit && amount > 1000 && desc.toLowerCase().includes("solar punk")) {
      // Simulate MRR hook for large deposits from assumed clients
      await prisma.revenue.create({
         data: {
            month: new Date(isoDate),
            amount: amount,
            currency: bankAccount.currency,
            type: "recurring",
            source: "bank_sync",
            userId: adminId,
            organizationId: orgId
         }
      });
      revenueCount++;
    }
  }

  console.log(`✅ Statement Ingestion Complete: ${trxnCount} transactions inserted, ${revenueCount} logged as MRR.`);
}

async function ingestInvoices(adminId: string, orgId: string) {
  console.log(`[2] Triggering Autonomous A/P Webhook Simulation on ${INVOICES.length} Invoices...`);
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
     console.error("⚠️ GEMINI_API_KEY is missing. Aborting OCR.");
     return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  for (const fileName of INVOICES) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) {
      console.log(`- ⚠️ Missing ${fileName}, skipping.`);
      continue;
    }

    console.log(`- 📄 Parsing ${fileName} via Gemini Vision...`);
    const buffer = fs.readFileSync(filePath);
    const imageBase64 = buffer.toString("base64");

    const result = await model.generateContent([
      { text: OCR_PROMPT },
      { inlineData: { mimeType: "application/pdf", data: imageBase64 } },
    ]);

    const text = result.response.text().trim();
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const extracted = JSON.parse(cleaned);

    const receipt = await prisma.receipt.create({
      data: {
        fileName,
        mimeType: "application/pdf",
        imageData: imageBase64.substring(0, 100) + "...", // Truncate
        status: "processed",
        confidence: extracted.confidence || 0.85,
        extractedData: JSON.stringify(extracted),
        extractedAmount: extracted.amount || 0,
        extractedVendor: extracted.vendor || "Unknown Vendor",
        extractedDate: extracted.date ? new Date(extracted.date) : new Date(),
        userId: adminId,
      },
    });

    const expense = await prisma.expense.create({
      data: {
        description: extracted.description || `Auto-Parsed: ${fileName}`,
        amount: Number(extracted.amount) || 0,
        currency: extracted.currency || "INR",
        date: extracted.date ? new Date(extracted.date) : new Date(),
        vendor: extracted.vendor || "Unknown Vendor",
        source: "email_inbox",
        sourceId: receipt.id,
        userId: adminId,
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
        comments: `Parsed automatically via E2E Tester`,
        expenseId: expense.id,
        approverId: adminId,
      }
    });

    console.log(`   ✔️ Queued to A/P Inbox: ${expense.vendor} - ${expense.amount} ${expense.currency}`);
  }
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (!admin || !admin.organizationId) throw new Error("Admin configuration missing.");

  await ingestStatement(admin.id, admin.organizationId);
  await ingestInvoices(admin.id, admin.organizationId);
  
  console.log("\n🚀 **E2E Ingestion Complete!** Check /ap-inbox and /saas-metrics in your browser.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
