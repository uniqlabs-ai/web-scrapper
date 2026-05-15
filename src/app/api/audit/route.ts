import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const AuditLogSchema = z.object({
  action: z.enum(["create", "update", "delete", "import", "export", "login", "process"]),
  resource: z.string().min(1).max(100),
  resourceId: z.string().max(200).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/**
 * GET /api/audit — Paginated audit log from DB
 * POST /api/audit — Log an action (internal use)
 */

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") || 50), 200);
    const offset = Number(searchParams.get("offset") || 0);
    const resource = searchParams.get("resource");
    const action = searchParams.get("action");

    const where: Record<string, unknown> = { userId };
    if (resource) where.resource = resource;
    if (action) where.action = action;

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
      take: 500,
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        select: {
          id: true,
          action: true,
          resource: true,
          resourceId: true,
          details: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        action: e.action,
        resource: e.resource,
        resourceId: e.resourceId,
        details: e.details ? JSON.parse(e.details) : null,
        timestamp: e.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    log.error("Audit GET error", { module: "audit", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = AuditLogSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { action, resource, resourceId, details } = parsed.data;

    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resource,
        resourceId,
        details: details ? JSON.stringify(details) : null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Audit POST error", { module: "audit", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
