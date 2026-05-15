import { prisma } from "@/lib/prisma";
import { log, toLogError } from "@/lib/logger";
import { headers } from "next/headers";

/**
 * Extract the client IP from Next.js request headers.
 * Supports standard proxy headers (x-forwarded-for, x-real-ip).
 */
async function getClientIp(): Promise<string | null> {
  try {
    const hdrs = await headers();
    // Standard proxy header chain
    const xff = hdrs.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    // Fallback headers
    return hdrs.get("x-real-ip") || hdrs.get("cf-connecting-ip") || null;
  } catch {
    return null;
  }
}

/**
 * Log an action to the audit trail.
 * Non-blocking — errors are caught and logged silently.
 * IP address is automatically captured from request headers.
 */
export async function logAudit(params: {
  userId: string;
  action: "create" | "update" | "delete" | "import" | "export" | "login" | "process";
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string; // Manual override (e.g., from webhook context)
}) {
  try {
    const ip = params.ipAddress || await getClientIp();

    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        details: params.details ? JSON.stringify(params.details) : null,
        ipAddress: ip,
      },
    });
  } catch (error) {
    log.error("Audit log write failed", { module: "audit", action: params.action, userId: params.userId, error: toLogError(error) });
    // Non-blocking — don't throw
  }
}
