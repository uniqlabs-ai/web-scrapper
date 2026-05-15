import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { calculateGSTSummary } from "@/lib/financial-intelligence";
import { log, toLogError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    // Default to current quarter
    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0);

    const from = fromParam ? new Date(fromParam) : quarterStart;
    const to = toParam ? new Date(toParam) : quarterEnd;

    const summary = await calculateGSTSummary(userId, organizationId, from, to);

    return NextResponse.json(summary);
  } catch (error) {
    log.error("GST summary error", { module: "reports", action: "tax", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to generate GST summary" },
      { status: 500 }
    );
  }
}
