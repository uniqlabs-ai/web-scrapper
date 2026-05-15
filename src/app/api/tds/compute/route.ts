import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { TdsComputeSchema } from "@/lib/schemas";

// TDS rate table — FY 2025-26 (Finance Act 2025)
const TDS_RATES: Record<string, { section: string; rate: number; threshold: number; description: string }> = {
  "Professional Services": { section: "194J", rate: 10, threshold: 50000, description: "Fees for professional/technical services" },
  "Consulting": { section: "194J", rate: 10, threshold: 50000, description: "Consultation fees" },
  "Technical Services": { section: "194J", rate: 2, threshold: 50000, description: "Technical services (reduced rate)" },
  "Rent": { section: "194I", rate: 10, threshold: 600000, description: "Rent on land/building/furniture" },
  "Office Space": { section: "194I", rate: 10, threshold: 600000, description: "Office rent" },
  "Equipment Rent": { section: "194I", rate: 2, threshold: 600000, description: "Rent on machinery/equipment" },
  "Contractor": { section: "194C", rate: 2, threshold: 30000, description: "Payment to contractor (company)" },
  "Contractor Individual": { section: "194C", rate: 1, threshold: 30000, description: "Payment to contractor (individual)" },
  "Salary & Wages": { section: "192", rate: 0, threshold: 0, description: "TDS on salary — computed per slab" },
  "Commission": { section: "194H", rate: 2, threshold: 20000, description: "Commission or brokerage" },
  "Insurance Commission": { section: "194D", rate: 5, threshold: 20000, description: "Insurance commission" },
  "Interest": { section: "194A", rate: 10, threshold: 10000, description: "Interest other than securities (non-bank)" },
  "Bank Interest": { section: "194A", rate: 10, threshold: 50000, description: "Interest from bank/co-op/post office" },
  "Software License": { section: "194J", rate: 10, threshold: 50000, description: "Royalty/software license" },
};

// POST: Auto-compute TDS for an expense
export async function POST(request: Request) {
  try {
    const limited = rateLimit(request as NextRequest, { windowSec: 60, max: 15, prefix: "tds-compute" });
    if (limited) return limited;
    await requireTenant();
    const rawBody = await request.json();

    const parsed = TdsComputeSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const { category, amount, vendorType = "company" } = parsed.data;

    if (!category || !amount) {
      return NextResponse.json({ error: "Category and amount are required" }, { status: 400 });
    }

    // Find matching TDS rule
    let tdsRule = TDS_RATES[category];

    // Fallback: check if category contains keywords
    if (!tdsRule) {
      const catLower = category.toLowerCase();
      if (catLower.includes("professional") || catLower.includes("consulting") || catLower.includes("legal") || catLower.includes("ca ") || catLower.includes("audit")) {
        tdsRule = TDS_RATES["Professional Services"];
      } else if (catLower.includes("rent") || catLower.includes("office space") || catLower.includes("lease")) {
        tdsRule = TDS_RATES["Rent"];
      } else if (catLower.includes("contractor") || catLower.includes("labour") || catLower.includes("maintenance")) {
        tdsRule = vendorType === "individual" ? TDS_RATES["Contractor Individual"] : TDS_RATES["Contractor"];
      } else if (catLower.includes("commission") || catLower.includes("brokerage")) {
        tdsRule = TDS_RATES["Commission"];
      } else if (catLower.includes("interest")) {
        tdsRule = TDS_RATES["Interest"];
      } else if (catLower.includes("software") || catLower.includes("license") || catLower.includes("royalty")) {
        tdsRule = TDS_RATES["Software License"];
      }
    }

    if (!tdsRule) {
      return NextResponse.json({
        applicable: false,
        message: "TDS not applicable for this category",
        tdsAmount: 0,
      });
    }

    const numAmount = Number(amount);

    // Check threshold
    if (numAmount < tdsRule.threshold) {
      return NextResponse.json({
        applicable: false,
        section: tdsRule.section,
        rate: tdsRule.rate,
        threshold: tdsRule.threshold,
        message: `Amount ₹${numAmount.toLocaleString("en-IN")} is below threshold ₹${tdsRule.threshold.toLocaleString("en-IN")} for Section ${tdsRule.section}`,
        tdsAmount: 0,
      });
    }

    const tdsAmount = Math.round((numAmount * tdsRule.rate) / 100);
    const netPayable = numAmount - tdsAmount;

    return NextResponse.json({
      applicable: true,
      section: tdsRule.section,
      rate: tdsRule.rate,
      threshold: tdsRule.threshold,
      description: tdsRule.description,
      tdsAmount,
      netPayable,
      grossAmount: numAmount,
      message: `TDS u/s ${tdsRule.section} @ ${tdsRule.rate}% = ₹${tdsAmount.toLocaleString("en-IN")}`,
    });
  } catch (error) {
    log.error("TDS compute error", { module: "tds", action: "compute", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to compute TDS" }, { status: 500 });
  }
}

// GET: Return TDS rate table for reference
export async function GET() {
  return NextResponse.json({ rates: TDS_RATES });
}
