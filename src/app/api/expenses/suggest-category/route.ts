import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const SuggestCategorySchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  amount: z.coerce.number().optional(),
  vendor: z.string().max(200).optional(),
});

// POST: Suggest category for an expense based on description
export async function POST(request: Request) {
  try {
    await requireTenant();
    const rawBody = await request.json();
    const parsed = SuggestCategorySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { description, amount, vendor } = parsed.data;

    // Rule-based fast path (instant, no API call)
    const desc = description.toLowerCase();
    const ruleMatch = matchByRules(desc, vendor?.toLowerCase() || "");
    if (ruleMatch) {
      return NextResponse.json({ category: ruleMatch, confidence: 0.9, source: "rules" });
    }

    // AI fallback if Gemini is available
    if (process.env.GEMINI_API_KEY) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(
          `Categorize this Indian business expense into EXACTLY ONE of these categories:
Salary & Wages, Cloud Infrastructure, Software Subscription, Office Space, Professional Services, Travel, Food & Meals, Marketing, Insurance, Bank Charges, Tax Payments, Equipment & Supplies, Telecom & Internet, Loan & EMI, Utilities, Internal Transfer, Uncategorized

Expense: "${description}"${vendor ? ` | Vendor: ${vendor}` : ""}${amount ? ` | Amount: ₹${amount}` : ""}

Reply with ONLY the category name, nothing else.`
        );
        const category = result.response?.text()?.trim() || "Uncategorized";
        return NextResponse.json({ category, confidence: 0.85, source: "ai" });
      } catch {
        // Fall through to default
      }
    }

    return NextResponse.json({ category: "Uncategorized", confidence: 0, source: "default" });
  } catch (error) {
    log.error("Category suggest error", { module: "expenses", action: "suggest-category", error: toLogError(error) });
    return NextResponse.json({ category: "Uncategorized", confidence: 0, source: "error" });
  }
}

function matchByRules(desc: string, vendor: string): string | null {
  const combined = `${desc} ${vendor}`;

  const rules: [string[], string][] = [
    [["aws", "amazon web", "azure", "gcp", "google cloud", "digitalocean", "heroku", "vercel", "netlify", "cloudflare", "ec2", "s3 bucket"], "Cloud Infrastructure"],
    [["salary", "wages", "payroll", "compensation", "bonus"], "Salary & Wages"],
    [["slack", "notion", "figma", "github", "jira", "zoom", "google workspace", "microsoft 365", "zoho", "hubspot", "saas", "subscription", "annual plan", "monthly plan"], "Software Subscription"],
    [["rent", "coworking", "wework", "office space", "lease", "regus", "91spring"], "Office Space"],
    [["ca ", "chartered accountant", "legal", "lawyer", "advocate", "consultant", "advisory", "audit", "compliance", "retainer"], "Professional Services"],
    [["flight", "hotel", "uber", "ola", "taxi", "train", "irctc", "makemytrip", "goibibo", "travel", "boarding"], "Travel"],
    [["swiggy", "zomato", "food", "lunch", "dinner", "meal", "restaurant", "cafe", "tea", "coffee"], "Food & Meals"],
    [["google ads", "facebook ads", "meta ads", "linkedin", "marketing", "campaign", "ad spend", "seo", "branding", "promotion"], "Marketing"],
    [["insurance", "lic", "hdfc ergo", "icici lombard", "policy", "premium"], "Insurance"],
    [["bank charge", "bank fee", "service charge", "gst on bank", "processing fee", "annual maintenance"], "Bank Charges"],
    [["gst", "tds", "advance tax", "income tax", "challan", "tax payment", "cess"], "Tax Payments"],
    [["laptop", "computer", "printer", "equipment", "furniture", "hardware", "monitor", "keyboard", "stationery"], "Equipment & Supplies"],
    [["airtel", "jio", "vodafone", "internet", "broadband", "mobile", "telephone", "wifi"], "Telecom & Internet"],
    [["emi", "loan", "interest", "principal", "repayment", "installment"], "Loan & EMI"],
    [["electricity", "water", "power", "utility", "gas", "maintenance"], "Utilities"],
    [["transfer", "internal", "self", "own account"], "Internal Transfer"],
  ];

  for (const [keywords, category] of rules) {
    if (keywords.some((k) => combined.includes(k))) {
      return category;
    }
  }
  return null;
}
