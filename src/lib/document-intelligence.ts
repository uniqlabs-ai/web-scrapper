import { GoogleGenerativeAI } from "@google/generative-ai";
import { log, toLogError } from "@/lib/logger";

let geminiModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null = null;

function getModel() {
  if (geminiModel) return geminiModel;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  return geminiModel;
}

export interface ParsedReceiptData {
  vendorName: string | null;
  date: string | null;
  amount: number | null;
  gstNumber: string | null;
  category: string | null;
  confidence: number;
}

const SYSTEM_PROMPT = `You are an AI Document Intelligence agent. Your job is to extract financial data from the provided receipt, invoice, or bill image.
Return ONLY a valid JSON object exactly matching the following schema. Do not include markdown formatting or explanations.
{
  "vendorName": "extracted vendor name or null",
  "date": "ISO date string (YYYY-MM-DDT00:00:00.000Z) or null",
  "amount": 99.99,
  "gstNumber": "extracted GSTIN or null",
  "category": "Inferred expense category (e.g. Software, Meals, Travel, Office Supplies) or null",
  "confidence": 0.95
}`;

export async function parseReceiptWithAI(base64Image: string, mimeType: string): Promise<ParsedReceiptData | null> {
  const model = getModel();
  if (!model) {
    log.warn("GEMINI_API_KEY not set — cannot parse receipt", { module: "document-intelligence", action: "parseReceipt" });
    return null;
  }

  try {
    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
    ]);

    const text = result.response.text().trim();
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ParsedReceiptData;
    
    return parsed;
  } catch (error) {
    log.warn("Gemini vision parse failed", { module: "document-intelligence", action: "parseReceipt", error: toLogError(error) });
    return null;
  }
}
