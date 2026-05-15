import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { log } from "@/lib/logger";

/**
 * Founder OS JWT Verification Middleware
 *
 * Accepts Bearer tokens from the Founder OS Layer 1 orchestrator.
 * Cryptographically verifies the JWT signature against FOUNDER_OS_JWT_SECRET.
 */

const FOUNDER_OS_JWT_SECRET = process.env.FOUNDER_OS_JWT_SECRET;

interface FounderOSToken {
  sub: string;
  email: string;
  organizationId?: string;
  role?: string;
  iat: number;
  exp: number;
}

export function extractFounderOSToken(request: NextRequest): FounderOSToken | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  // Require FOUNDER_OS_JWT_SECRET in production — fail-closed
  if (!FOUNDER_OS_JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
      log.error("FOUNDER_OS_JWT_SECRET not set — rejecting token in production", { module: "founder-os-jwt", action: "verify" });
      return null;
    }
    // In development only: allow unsigned decode for local testing
    log.warn("FOUNDER_OS_JWT_SECRET not set — dev-mode decode only", { module: "founder-os-jwt", action: "verify" });
    return devOnlyDecode(token);
  }

  try {
    // Cryptographically verify the JWT signature
    const payload = jwt.verify(token, FOUNDER_OS_JWT_SECRET) as Record<string, unknown>;

    return {
      sub: payload.sub as string,
      email: payload.email as string,
      organizationId: (payload.organizationId || payload.org_id) as string | undefined,
      role: payload.role as string | undefined,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("Token verification failed", { module: "founder-os-jwt", action: "verify", error: { message, name: "JWTVerificationError" } });
    return null;
  }
}

/**
 * Dev-only fallback: decode without verification.
 * NEVER used in production — guarded by FOUNDER_OS_JWT_SECRET + NODE_ENV checks above.
 */
function devOnlyDecode(token: string): FounderOSToken | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      log.warn("Token expired", { module: "founder-os-jwt", action: "decode" });
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      organizationId: payload.organizationId || payload.org_id,
      role: payload.role,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function requireAuth(request: NextRequest): FounderOSToken | null {
  return extractFounderOSToken(request);
}
