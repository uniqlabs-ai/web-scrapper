import { NextRequest, NextResponse } from "next/server";
import { extractFounderOSToken } from "@/lib/founder-os-jwt";
import { prisma } from "@/lib/prisma";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const FounderOsTokenSchema = z.object({
  email: z.string().email(),
  sub: z.string().min(1),
  organizationId: z.string().optional(),
  role: z.string().optional(),
  exp: z.number(),
});

/**
 * POST /api/v1/auth/founder-os-token
 *
 * SSO token exchange endpoint.
 * Accepts a Founder OS JWT and returns a session for the Finance app.
 * If the user doesn't exist locally, creates a minimal profile.
 */
export async function POST(request: NextRequest) {
  try {
    const token = extractFounderOSToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Invalid or missing Founder OS JWT" },
        { status: 401 }
      );
    }

    const tokenParsed = FounderOsTokenSchema.safeParse(token);
    if (!tokenParsed.success) {
      return NextResponse.json(
        { error: "Token validation failed", details: tokenParsed.error.issues },
        { status: 401 }
      );
    }

    // Find or create the user locally
    let user = await prisma.user.findFirst({
      where: { email: token.email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: token.email,
          fullName: token.email.split("@")[0],
        },
      });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.fullName,
      },
      founderOS: {
        sub: token.sub,
        organizationId: token.organizationId,
        role: token.role,
      },
      expiresAt: new Date(token.exp * 1000).toISOString(),
    });
  } catch (error) {
    log.error("Error", { module: "auth", action: "founder-os-token", error: toLogError(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
