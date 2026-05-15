import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const OcrJsonSchema = z.object({
  image: z.string().min(1, "Base64 image data is required"),
  mimeType: z.string().max(50).optional(),
  fileName: z.string().max(200).optional(),
});
const OCR_PROMPT = `You are a receipt/invoice OCR system. Analyze this image and extract structured data.

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
- Dates in ISO format (YYYY-MM-DD)
- GSTIN format: 2-digit state code + 10-char PAN + 1 entity code + 1 Z + 1 check digit
- Return ONLY valid JSON, no markdown or explanation`;

export async function POST(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const contentType = request.headers.get("content-type") || "";

    let imageBase64: string;
    let mimeType: string;
    let fileName: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }

      const buffer = await file.arrayBuffer();
      imageBase64 = Buffer.from(buffer).toString("base64");
      mimeType = file.type || "image/jpeg";
      fileName = file.name || "receipt.jpg";
    } else {
      // JSON body with base64 image
      const rawBody = await request.json();
      const parsed = OcrJsonSchema.safeParse(rawBody);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
      }
      imageBase64 = parsed.data.image.replace(/^data:image\/\w+;base64,/, "");
      mimeType = parsed.data.mimeType || "image/jpeg";
      fileName = parsed.data.fileName || "receipt.jpg";
    }

    // Call Gemini Vision
    const apiKey = process.env.GEMINI_API_KEY;
    let extracted;

    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const result = await model.generateContent([
        { text: OCR_PROMPT },
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
      ]);

      const text = result.response.text().trim();
      const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      extracted = JSON.parse(cleaned);
    } else {
      return NextResponse.json({ error: "OCR Service (Gemini API) is currently unconfigured or unavailable." }, { status: 503 });
    }

    // Save receipt to database
    const receipt = await prisma.receipt.create({
      data: {
        fileName,
        mimeType,
        imageData: imageBase64.substring(0, 200) + "...", // Store truncated for DB (full image in production would use S3)
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

    return NextResponse.json({
      receipt: {
        id: receipt.id,
        fileName: receipt.fileName,
        status: receipt.status,
        confidence: receipt.confidence,
      },
      extracted,
    });
  } catch (error) {
    log.error("OCR error", { module: "expenses", action: "ocr", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to process receipt" }, { status: 500 });
  }
}
