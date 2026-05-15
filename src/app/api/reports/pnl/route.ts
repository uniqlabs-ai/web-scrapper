import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { generatePnL } from "@/lib/financial-intelligence";
import { log, toLogError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const now = new Date();
    const from = fromParam
      ? new Date(fromParam)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toParam
      ? new Date(toParam)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const report = await generatePnL(userId, organizationId, from, to);

    return NextResponse.json(report);
  } catch (error) {
    log.error("P&L report error", { module: "reports", action: "pnl", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to generate P&L report" },
      { status: 500 }
    );
  }
}
