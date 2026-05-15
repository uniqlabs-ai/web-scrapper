import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const PdfImportFileSchema = z.object({
  fileName: z.string().min(1).max(500).refine(n => n.toLowerCase().endsWith(".pdf"), "Only PDF files are supported"),
  sizeBytes: z.number().max(50 * 1024 * 1024, "File exceeds 50MB limit"),
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// POST: Parse a PDF financial statement using Gemini
export async function POST(request: Request) {
  try {
    const { userId, organizationId } = await requireTenant();
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const _target = (formData.get("target") as string) || "auto";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileParsed = PdfImportFileSchema.safeParse({ fileName: file.name, sizeBytes: file.size });
    if (!fileParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: fileParsed.error.issues }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Read file as base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    const prompt = `You are an expert Indian chartered accountant and financial document parser. This PDF is likely an audited financial statement, ITR filing, bank statement, or financial report for an Indian company/LLP/firm.

Your job is to EXHAUSTIVELY extract EVERY financial line item from ALL sections of this document. This is critically important — do NOT skip any section.

SECTIONS TO PARSE (check ALL of these in the PDF):
1. **Profit & Loss / Income & Expenditure Statement** — Extract EVERY income line AND EVERY expense line
2. **Balance Sheet** — Extract all asset items, liability items, and equity/capital items
3. **Cash Flow Statement** — Operating, investing, financing activities
4. **Schedules / Notes to Accounts** — These contain the DETAILED breakdowns (e.g. Schedule of Revenue, Schedule of Operating Expenses). Parse EVERY sub-item in every schedule.
5. **Tax Computation** — If present, extract taxable income, deductions, tax payable
6. **Capital Account / Partners Account** — For LLPs/firms, extract each partner's capital
7. **Trial Balance** — If present, extract each account with debit/credit

CRITICAL RULES:
- Go through EVERY PAGE of the PDF
- For each schedule/note, extract the INDIVIDUAL sub-items, not just the schedule total
- For P&L: extract each revenue source separately, each expense head separately
- For Balance Sheet: extract each fixed asset, current asset, current liability separately
- When a line item shows amounts for multiple years, use the CURRENT year amount
- Indian amounts may use lakhs/crores notation — convert to plain numbers
- If you see "Previous Year" and "Current Year" columns, always use Current Year
- Amounts should be positive numbers — use the "type" field to indicate direction

Return a JSON object with this EXACT structure:
{
  "documentType": "audited_financials" | "profit_and_loss" | "balance_sheet" | "bank_statement" | "itr" | "tax_return" | "other",
  "companyName": "extracted company/LLP/firm name",
  "period": "the financial year or period (e.g. 'FY 2023-24' or 'April 2023 - March 2024')",
  "currency": "INR",
  "summary": {
    "totalRevenue": number or null,
    "totalExpenses": number or null,
    "netProfit": number or null,
    "totalAssets": number or null,
    "totalLiabilities": number or null,
    "cashBalance": number or null,
    "taxPayable": number or null
  },
  "lineItems": [
    {
      "date": "YYYY-MM-DD or null (use financial year end date like 2024-03-31 if only year is known)",
      "description": "detailed line item description",
      "section": "which section this came from: P&L | Balance Sheet | Cash Flow | Schedule | Tax | Capital",
      "category": "specific category (e.g. Professional Fees, Salary & Wages, Rent, Depreciation, Interest Income, Service Revenue, Bank Charges, GST Input Credit, TDS Receivable, etc.)",
      "amount": number (positive, in rupees — convert from lakhs/crores if needed),
      "type": "expense | revenue | asset | liability | equity | tax",
      "reference": "schedule number or note reference if available"
    }
  ]
}

IMPORTANT:
- Extract as MANY line items as possible — aim for 30-100+ items from a full audited statement
- Do NOT just extract 5-10 summary totals — dig into each schedule
- Amounts should be plain numbers in rupees (not in lakhs/crores)
- Return ONLY valid JSON, no markdown fences, no explanation`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64,
        },
      },
    ]);

    const text = result.response?.text() || "";

    // Clean the response — remove markdown code fences if present
    let jsonStr = text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      log.error("Failed to parse Gemini response", { module: "import", action: "pdf", error: toLogError(text) });
      return NextResponse.json(
        { error: "Failed to parse document. AI response was not valid JSON.", raw: text.substring(0, 500) },
        { status: 422 }
      );
    }

    // Store import batch for tracking
    const user = await prisma.user.findUnique({ where: { id: userId } });

    const batch = await prisma.importBatch.create({
      data: {
        type: "financial_statement",
        fileName: file.name,
        rowCount: parsed.lineItems?.length || 0,
        status: "completed",
        columnMapping: JSON.stringify({
          documentType: parsed.documentType,
          companyName: parsed.companyName,
          period: parsed.period,
        }),
        userId,
      },
    });

    // Auto-import line items based on document type
    let imported = 0;
    const items = parsed.lineItems || [];

    for (const item of items) {
      try {
        const itemDate = item.date ? new Date(item.date) : new Date();
        const amount = Math.abs(Number(item.amount) || 0);
        if (amount === 0) continue;

        const isExpenseType = ["debit", "expense"].includes(item.type);
        const isRevenueType = ["credit", "revenue"].includes(item.type);

        if (isExpenseType) {
          await prisma.expense.create({
            data: {
              userId,
              organizationId: user?.organizationId,
              description: item.description || "Imported expense",
              amount,
              date: itemDate,
              category: item.category || "Uncategorized",
              vendor: item.reference || undefined,
              notes: `Imported from ${file.name} (${parsed.documentType})`,
            },
          });
          imported++;
        } else if (isRevenueType) {
          await prisma.revenue.create({
            data: {
              userId,
              organizationId: user?.organizationId,
              source: item.description || "Imported revenue",
              amount,
              month: itemDate,
              notes: `Imported from ${file.name} (${parsed.documentType})`,
            },
          });
          imported++;
        } else {
          // For assets, liabilities, and other types — store as expenses with special category
          await prisma.expense.create({
            data: {
              userId,
              organizationId: user?.organizationId,
              description: item.description || `${item.type} item`,
              amount,
              date: itemDate,
              category: item.category || item.type || "Uncategorized",
              notes: `Imported from ${file.name} (${parsed.documentType}) — ${item.type}`,
            },
          });
          imported++;
        }
      } catch (itemErr) {
        log.error("Failed to import item", { module: "import", action: "pdf", error: toLogError(itemErr) });
      }
    }

    return NextResponse.json({
      success: true,
      documentType: parsed.documentType,
      companyName: parsed.companyName,
      period: parsed.period,
      currency: parsed.currency,
      summary: parsed.summary,
      lineItems: items.length,
      imported,
      batchId: batch.id,
    });
  } catch (error) {
    log.error("PDF import error", { module: "import", action: "pdf", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to process PDF" },
      { status: 500 }
    );
  }
}
