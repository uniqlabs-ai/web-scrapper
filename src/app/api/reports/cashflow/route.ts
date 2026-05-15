import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { projectCashFlow, projectCashFlowOutlook } from "@/lib/financial-intelligence";
import { log, toLogError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view");

    if (view === "outlook") {
      const outlook = await projectCashFlowOutlook(userId, organizationId);
      return NextResponse.json(outlook);
    }

    const months = parseInt(searchParams.get("months") || "6", 10);

    const projection = await projectCashFlow(userId, organizationId, Math.min(months, 24));

    return NextResponse.json(projection);
  } catch (error) {
    log.error("Cash flow projection error", { module: "reports", action: "cashflow", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to generate cash flow projection" },
      { status: 500 }
    );
  }
}
