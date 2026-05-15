import { NextResponse } from "next/server";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/gst/hsn — HSN/SAC code library for Indian goods and services
 */

// HSN/SAC code library — GST rates verified for FY 2025-26
const HSN_CODES = [
  // Services (SAC codes)
  { code: "998311", description: "Management consulting services", gstRate: 18 },
  { code: "998312", description: "Business consulting services", gstRate: 18 },
  { code: "998313", description: "IT consulting and support", gstRate: 18 },
  { code: "998314", description: "IT design and development", gstRate: 18 },
  { code: "998315", description: "Hosting and IT infrastructure", gstRate: 18 },
  { code: "998316", description: "IT infrastructure management", gstRate: 18 },
  { code: "998321", description: "Accounting and bookkeeping", gstRate: 18 },
  { code: "998322", description: "Tax preparation services", gstRate: 18 },
  { code: "998323", description: "Payroll services", gstRate: 18 },
  { code: "998331", description: "Legal advisory services", gstRate: 18 },
  { code: "998332", description: "Legal documentation", gstRate: 18 },
  { code: "998341", description: "Architectural services", gstRate: 18 },
  { code: "998351", description: "Scientific R&D", gstRate: 18 },
  { code: "998361", description: "Advertising services", gstRate: 18 },
  { code: "998362", description: "Market research", gstRate: 18 },
  { code: "998363", description: "Public relations", gstRate: 18 },
  { code: "998371", description: "Photography services", gstRate: 18 },
  { code: "998391", description: "Recruitment services", gstRate: 18 },
  { code: "998392", description: "Training services", gstRate: 18 },
  { code: "997212", description: "Rental of commercial property", gstRate: 18 },
  { code: "997311", description: "Leasing of machinery", gstRate: 18 },
  { code: "996311", description: "Courier services", gstRate: 18 },
  { code: "996411", description: "Telecommunication services", gstRate: 18 },
  { code: "997111", description: "Financial services (banking)", gstRate: 18 },
  { code: "997112", description: "Insurance services", gstRate: 18 },
  { code: "996511", description: "Cloud computing services", gstRate: 18 },

  // Goods (HSN codes)
  { code: "8471", description: "Computers and laptops", gstRate: 18 },
  { code: "8473", description: "Computer parts and accessories", gstRate: 18 },
  { code: "8443", description: "Printers and scanners", gstRate: 18 },
  { code: "8517", description: "Mobile phones and telecom equipment", gstRate: 18 },
  { code: "8528", description: "Monitors and displays", gstRate: 18 },
  { code: "9403", description: "Office furniture", gstRate: 18 },
  { code: "4820", description: "Stationery and paper", gstRate: 12 },
  { code: "4901", description: "Printed books", gstRate: 0 },
  { code: "2201", description: "Packaged drinking water", gstRate: 5 },
  { code: "0901", description: "Coffee and tea", gstRate: 5 },
  { code: "8523", description: "Software (physical media)", gstRate: 18 },
];

export async function GET() {
  try {
    const grouped = {
      services: HSN_CODES.filter((h) => h.code.startsWith("99")),
      goods: HSN_CODES.filter((h) => !h.code.startsWith("99")),
    };

    return NextResponse.json({
      codes: HSN_CODES,
      groups: grouped,
      summary: {
        total: HSN_CODES.length,
        services: grouped.services.length,
        goods: grouped.goods.length,
      },
    });
  } catch (error) {
    log.error("HSN error", { module: "gst", action: "hsn", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
