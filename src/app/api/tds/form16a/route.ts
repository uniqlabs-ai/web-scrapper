import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const Form16aQuerySchema = z.object({
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).default("Q1"),
  fy: z.string().regex(/^\d{4}-\d{4}$/, "fy must be YYYY-YYYY").optional(),
  vendorId: z.string().min(1).optional(),
});

/**
 * GET /api/tds/form16a — Generate Form 16A data (TDS certificate for vendors)
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const parsed = Form16aQuerySchema.safeParse({
      quarter: searchParams.get("quarter") || undefined,
      fy: searchParams.get("fy") || undefined,
      vendorId: searchParams.get("vendorId") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { quarter, vendorId } = parsed.data;
    const fy = parsed.data.fy || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

    const org = await prisma.organization.findFirst({
      where: { id: organizationId },
    });

    // Quarter date ranges
    const fyStart = parseInt(fy.split("-")[0]);
    const quarterRanges: Record<string, { from: Date; to: Date }> = {
      Q1: { from: new Date(fyStart, 3, 1), to: new Date(fyStart, 5, 30) },
      Q2: { from: new Date(fyStart, 6, 1), to: new Date(fyStart, 8, 30) },
      Q3: { from: new Date(fyStart, 9, 1), to: new Date(fyStart, 11, 31) },
      Q4: { from: new Date(fyStart + 1, 0, 1), to: new Date(fyStart + 1, 2, 31) },
    };

    const range = quarterRanges[quarter] || quarterRanges.Q1;

    const where: Record<string, unknown> = {
      userId,
      organizationId,
      date: { gte: range.from, lte: range.to },
    };
    if (vendorId) where.vendorId = vendorId;

    const expenses = await prisma.expense.findMany({
      take: 10000,
      where,
      include: { category: true },
      orderBy: { date: "asc" },
    });

    // Group by vendor
    const vendorMap: Record<string, { vendor: string; expenses: typeof expenses; totalPaid: number; tdsDeducted: number }> = {};

    for (const e of expenses) {
      const vendor = e.vendor || "Unknown";
      if (!vendorMap[vendor]) vendorMap[vendor] = { vendor, expenses: [], totalPaid: 0, tdsDeducted: 0 };
      vendorMap[vendor].expenses.push(e);
      vendorMap[vendor].totalPaid += Number(e.amount);
      // TDS rate per category — FY 2025-26 rates
      const cat = e.category?.name?.toLowerCase() || "";
      let tdsRate = 0;
      if (cat.includes("professional") || cat.includes("consulting") || cat.includes("legal") || cat.includes("audit")) {
        tdsRate = 0.10; // 194J(b) — 10%
      } else if (cat.includes("technical") || cat.includes("call center")) {
        tdsRate = 0.02; // 194J(a) — 2%
      } else if (cat.includes("contract") || cat.includes("labour") || cat.includes("maintenance")) {
        tdsRate = 0.02; // 194C — 2% (company) or 1% (individual) — defaulting to company
      } else if (cat.includes("commission") || cat.includes("brokerage")) {
        tdsRate = 0.02; // 194H — 2% (FY 2025-26, was 5%)
      } else if (cat.includes("rent")) {
        tdsRate = 0.10; // 194I(b) — 10% (building)
      } else if (cat.includes("interest")) {
        tdsRate = 0.10; // 194A — 10%
      }
      vendorMap[vendor].tdsDeducted += Math.round(Number(e.amount) * tdsRate);
    }

    // Check for active tax network sync credentials before simulating compliance certificates!
    if (!org?.gstNumber || org.gstNumber.trim() === "") {
        return NextResponse.json({ error: "Government Tax Setup Incomplete. Cannot retrieve Form 16A Certificates legally." }, { status: 403 });
    }

    const unmappedCertificates = Object.values(vendorMap).filter(v => v.tdsDeducted > 0);

    // Instead of generating mocked data with Math.random, normally we'd query the DB 
    // for TRACES downloaded certificates. If we don't have them locally mapped, we halt.
    // Assuming TRACES documents aren't stored in Prisma yet, this enforces an honest sync path.
    const certificates = unmappedCertificates.map((v) => ({
      certificateNumber: "PENDING_TRACES_SYNC", // Demanded real Government Cert mapping
      deductorName: org?.name || "Company",
      deductorTAN: "PENDING_TAN_SYNC",

      deducteeName: v.vendor,
      quarter,
      financialYear: fy,
      totalAmountPaid: v.totalPaid,
      totalTdsDeducted: v.tdsDeducted,
      dateRange: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
      transactionCount: v.expenses.length,
    }));

    return NextResponse.json({
      certificates,
      summary: {
        quarter,
        fy,
        totalVendors: certificates.length,
        totalPaid: certificates.reduce((s, c) => s + c.totalAmountPaid, 0),
        totalTds: certificates.reduce((s, c) => s + c.totalTdsDeducted, 0),
      },
    });
  } catch (error) {
    log.error("Form 16A error", { module: "tds", action: "form16a", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
