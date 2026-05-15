import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/webhooks";
import { log, toLogError } from "@/lib/logger";
import { InboundEmailWebhookSchema } from "@/lib/schemas";

const OCR_PROMPT = `You are an AI AP Inbox system performing OCR. Analyze this invoice/receipt image and extract structured data.

Return ONLY a JSON object with these fields (use null for any field you cannot extract):
{
  "amount": <number, total amount>,
  "vendor": "<string, store/company name>",
  "date": "<string, ISO date format YYYY-MM-DD>",
  "gstNumber": "<string, GSTIN if visible>",
  "category": "<string, one of: Food, Travel, Office Supplies, Software, Marketing, Utilities, Rent, Professional Services, Equipment, Miscellaneous>",
  "description": "<string, brief description of the purchase>",
  "lineItems": [{"description": "<string>", "quantity": <number>, "amount": <number>}],
  "currency": "<string, ISO currency code, default INR>",
  "paymentMethod": "<string, cash/card/upi/bank_transfer if visible>",
  "confidence": <number, 0.0-1.0 your confidence in the extraction>
}

Rules:
- Extract amounts WITHOUT currency symbols
- Return ONLY valid JSON, no markdown or explanation`;

/**
 * POST /api/webhooks/inbound-email
 * Expects a standard inbound parse webhook payload (simulated)
 * { from: "...", subject: "...", attachments: [{ content: "<base64>", filename: "bill.png", content_type: "image/png" }] }
 */
export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text();

    // Verify webhook signature — fail-closed
    const signature = request.headers.get("x-webhook-signature") || "";
    if (!verifyWebhookSignature(bodyText, signature)) {
      return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
    }

    let rawBody;
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = InboundEmailWebhookSchema.safeParse(rawBody);
    if (!parsed.success) {
      // Return 200 for validation failures so webhooks don't retry endlessly
      return NextResponse.json({ message: "Validation failed", details: parsed.error.issues }, { status: 200 });
    }

    const { from, subject, attachments } = parsed.data;
    const attachment = attachments[0]; // grab the first bill

    if (!attachment.content_type.startsWith("image/")) {
      return NextResponse.json({ message: "Unsupported attachment type. Requires image (png/jpg/webp)." }, { status: 200 });
    }

    const imageBase64 = attachment.content; // Already parsed to base64 by the email gateway
    const mimeType = attachment.content_type;
    const fileName = attachment.filename;

    const apiKey = process.env.GEMINI_API_KEY;
    let extracted;

    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const result = await model.generateContent([
        { text: OCR_PROMPT },
        { inlineData: { mimeType, data: imageBase64 } },
      ]);

      const text = result.response.text().trim();
      const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      try {
        extracted = JSON.parse(cleaned);
      } catch (err) {
        log.error("Failed to parse Gemini OCR JSON", { module: "webhooks", action: "inbound-email", error: toLogError(cleaned) });
        throw err;
      }
    } else {
      return NextResponse.json({ error: "OCR extraction relies on Gemini API which is not configured." }, { status: 503 });
    }

    // Resolve tenant dynamically by inbound sender email
    // Example: "Jane Doe <jane@company.com>" -> extract jane@company.com
    const emailMatch = from.match(/<([^>]+)>/);
    const senderEmail = emailMatch ? emailMatch[1].toLowerCase() : from.toLowerCase();

    const senderUser = await prisma.user.findFirst({
      where: { email: senderEmail },
    });

    if (!senderUser) {
      log.warn("Unrecognized email domain for inbound receipt parsing", { module: "webhooks", action: "inbound-email", meta: { senderEmail } });
      // Return 200 so webhooks don't incessantly retry
      return NextResponse.json({ error: "Sender email is not linked to any active user." }, { status: 200 });
    }

    const userId = senderUser.id;
    const orgId = senderUser.organizationId;

    // RELIABILITY: Idempotency guard — prevent duplicate receipts on email webhook retry
    const existingReceipt = await prisma.receipt.findFirst({
      where: { fileName, userId },
    });
    if (existingReceipt) {
      log.info("Duplicate inbound email skipped", { module: "webhooks", action: "inbound-email", meta: { fileName, userId } });
      return NextResponse.json({ success: true, duplicate: true, receiptId: existingReceipt.id }, { status: 200 });
    }

    // Save receipt to DB
    const receipt = await prisma.receipt.create({
      data: {
        fileName,
        mimeType,
        imageData: imageBase64.substring(0, 200) + "...", // truncate
        status: "processed",
        confidence: extracted.confidence || 0.8,
        extractedData: JSON.stringify(extracted),
        extractedAmount: extracted.amount || null,
        extractedVendor: extracted.vendor || null,
        extractedDate: extracted.date ? new Date(extracted.date) : null,
        extractedGst: extracted.gstNumber || null,
        extractedCategory: extracted.category || null,
        userId,
      },
    });

    // Create Draft Expense
    const expense = await prisma.expense.create({
      data: {
        description: extracted.description || subject || "Auto-Parsed Bill",
        amount: Number(extracted.amount) || 0,
        currency: extracted.currency || "INR",
        date: extracted.date ? new Date(extracted.date) : new Date(),
        vendor: extracted.vendor || "Unknown Vendor",
        source: "email_inbox",
        sourceId: receipt.id,
        userId,
        organizationId: orgId,
      }
    });

    // Update receipt to link to expense
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { expenseId: expense.id }
    });

    // Stage it using ExpenseApproval so it's "pending" in the AP Inbox
    await prisma.expenseApproval.create({
      data: {
        status: "pending",
        comments: `Received via Email from ${from}`,
        expenseId: expense.id,
        approverId: userId, // Defaulting to the admin as approver
      }
    });

    return NextResponse.json({ success: true, expenseId: expense.id });
  } catch (error) {
    log.error("Inbound email webhook error", { module: "webhooks", action: "inbound-email", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to process inbound email" }, { status: 500 });
  }
}
