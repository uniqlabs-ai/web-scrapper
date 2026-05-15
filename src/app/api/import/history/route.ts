import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/import/history — Fetch import batch history
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    const batches = await prisma.importBatch.findMany({
      take: 500,
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ batches });
  } catch (error) {
    log.error("Import history error", { module: "import", action: "history", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
