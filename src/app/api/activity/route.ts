import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const resource = searchParams.get("resource") || "";
    const action = searchParams.get("action") || "";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

    const where: Record<string, unknown> = {
      user: { organizationId }, // SECURITY: scope to tenant
    };
    if (resource) where.resource = resource;
    if (action) where.action = action;

    const activities = await prisma.activityLog.findMany({
      take: limit,
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json({ activities });
  } catch (error) {
    log.error("Activity feed error", { module: "activity", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load activity feed" }, { status: 500 });
  }
}
