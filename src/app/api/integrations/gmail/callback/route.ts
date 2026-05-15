import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

const REDIRECT_URI = `${process.env.NEXTAUTH_URL || "http://localhost:3008"}/api/integrations/gmail/callback`;

// Handle Gmail OAuth callback
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL("/settings?tab=integrations&error=gmail_denied", request.url)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL("/settings?tab=integrations&error=no_code", request.url)
      );
    }

    const { userId, organizationId } = await requireTenant();

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokens.access_token) {
      log.error("Gmail token exchange failed", { module: "integrations", action: "gmail/callback", error: toLogError(tokens) });
      return NextResponse.redirect(
        new URL("/settings?tab=integrations&error=token_failed", request.url)
      );
    }

    // Get user's Gmail profile
    const profileRes = await fetch(
      "https://www.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const profile = await profileRes.json();

    // Upsert integration record
    const existing = await prisma.integration.findFirst({
      where: { userId, type: "gmail" },
    });

    if (existing) {
      await prisma.integration.update({
        where: { id: existing.id },
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existing.refreshToken,
          status: "connected",
          metadata: JSON.stringify({
            email: profile.emailAddress,
            scopes: tokens.scope,
          }),
        },
      });
    } else {
      await prisma.integration.create({
        data: {
          type: "gmail",
          userId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          status: "connected",
          metadata: JSON.stringify({
            email: profile.emailAddress,
            scopes: tokens.scope,
          }),
        },
      });
    }

    return NextResponse.redirect(
      new URL("/settings?tab=integrations&success=gmail_connected", request.url)
    );
  } catch (error) {
    log.error("Gmail callback error", { module: "integrations", action: "gmail/callback", error: toLogError(error) });
    return NextResponse.redirect(
      new URL("/settings?tab=integrations&error=callback_failed", request.url)
    );
  }
}
