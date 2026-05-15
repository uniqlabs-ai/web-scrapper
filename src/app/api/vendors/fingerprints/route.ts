import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { VendorFingerprintSchema } from "@/lib/schemas";

/**
 * GET /api/vendors/fingerprints
 * Builds a vendor→category fingerprint map from historical expense data.
 * Returns the mapping + stats for each vendor.
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    // Get all expenses with category for this user
    const expenses = await prisma.expense.findMany({
      take: 500,
      where: { userId, categoryId: { not: null } },
      select: { vendor: true, description: true, amount: true, categoryId: true, category: { select: { name: true, color: true } } },
    });

    // Build vendor fingerprint map
    const vendorMap: Record<string, {
      vendor: string;
      totalSpend: number;
      txnCount: number;
      categories: Record<string, { count: number; totalSpend: number; color: string }>;
    }> = {};

    for (const e of expenses) {
      const vendorKey = (e.vendor || "Unknown").trim();
      if (!vendorMap[vendorKey]) {
        vendorMap[vendorKey] = { vendor: vendorKey, totalSpend: 0, txnCount: 0, categories: {} };
      }
      const v = vendorMap[vendorKey];
      v.totalSpend += Number(e.amount);
      v.txnCount++;

      const catName = e.category?.name || "Uncategorized";
      const catColor = e.category?.color || "#9CA3AF";
      if (!v.categories[catName]) {
        v.categories[catName] = { count: 0, totalSpend: 0, color: catColor };
      }
      v.categories[catName].count++;
      v.categories[catName].totalSpend += Number(e.amount);
    }

    // Build fingerprints with dominant category + confidence
    const fingerprints = Object.values(vendorMap).map((v) => {
      const catEntries = Object.entries(v.categories)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.count - a.count);

      const dominant = catEntries[0];
      const confidence = dominant ? Math.round((dominant.count / v.txnCount) * 100) : 0;
      const isConsistent = confidence >= 80;

      return {
        vendor: v.vendor,
        totalSpend: v.totalSpend,
        txnCount: v.txnCount,
        dominantCategory: dominant?.name || "Unknown",
        dominantCategoryColor: dominant?.color || "#9CA3AF",
        confidence,
        isConsistent,
        categories: catEntries,
      };
    }).sort((a, b) => b.txnCount - a.txnCount);

    // Summary stats
    const totalVendors = fingerprints.length;
    const consistentVendors = fingerprints.filter((f) => f.isConsistent).length;
    const inconsistentVendors = fingerprints.filter((f) => !f.isConsistent && f.txnCount >= 3).length;

    return NextResponse.json({
      fingerprints,
      summary: {
        totalVendors,
        consistentVendors,
        inconsistentVendors,
        consistencyRate: totalVendors > 0 ? Math.round((consistentVendors / totalVendors) * 100) : 0,
      },
    });
  } catch (error) {
    log.error("Vendor fingerprint error", { module: "vendors", action: "fingerprints", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to build vendor fingerprints" }, { status: 500 });
  }
}

/**
 * POST /api/vendors/fingerprints
 * Apply vendor fingerprint: re-categorize all expenses from a given vendor
 * to the specified category.
 */
export async function POST(request: Request) {
  try {
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();

    const parsed = VendorFingerprintSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const { vendor, categoryId } = parsed.data;

    if (!vendor || !categoryId) {
      return NextResponse.json({ error: "vendor and categoryId are required" }, { status: 400 });
    }

    // Update all expenses from this vendor to the new category
    const result = await prisma.expense.updateMany({
      where: { userId, vendor },
      data: { categoryId },
    });

    // Also update bank transactions that match this vendor
    await prisma.bankTransaction.updateMany({
      where: { userId, vendor },
      data: { category: (await prisma.expenseCategory.findUnique({ where: { id: categoryId } }))?.name || vendor },
    });

    return NextResponse.json({
      success: true,
      updated: result.count,
      message: `Re-categorized ${result.count} expenses from "${vendor}"`,
    });
  } catch (error) {
    log.error("Vendor fingerprint apply error", { module: "vendors", action: "fingerprints", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to apply fingerprint" }, { status: 500 });
  }
}
