import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const EmptyBodySchema = z.object({}).strict();

const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
const REDIRECT_URI = `${process.env.NEXTAUTH_URL || "http://localhost:3008"}/api/integrations/gmail/callback`;

// GET: Check Gmail integration status
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const integration = await prisma.integration.findFirst({
      where: { userId, type: "gmail" },
    });

    return NextResponse.json({
      connected: integration?.status === "connected",
      status: integration?.status || "disconnected",
      lastSyncAt: integration?.lastSyncAt,
      syncCount: integration?.syncCount || 0,
      email: integration?.metadata ? JSON.parse(integration.metadata).email : null,
    });
  } catch (error) {
    log.error("Gmail status error", { module: "integrations", action: "gmail", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}

// POST: Start Gmail OAuth flow — returns auth URL
export async function POST() {
  try {
    const _validated = EmptyBodySchema.safeParse({});
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID in .env" },
        { status: 400 }
      );
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GMAIL_SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", "gmail_connect");

    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch (error) {
    log.error("Gmail auth error", { module: "integrations", action: "gmail", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to start auth" }, { status: 500 });
  }
}

// DELETE: Disconnect Gmail
export async function DELETE() {
  try {
    const guard = await requirePermission("write");
    if (!guard.allowed) return guard.response;
    const { userId } = guard;

    await prisma.integration.deleteMany({
      where: { userId, type: "gmail" },
    });

    logAudit({ userId, action: "delete", resource: "integration", details: { type: "gmail" } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Gmail disconnect error", { module: "integrations", action: "gmail", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
