import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// ── Edge-safe RBAC (inlined to avoid importing prisma via rbac.ts) ──
type Role = "admin" | "finance_manager" | "accountant" | "viewer" | "custom";
interface UserSession { role?: string; permissions?: string; }
const ROLE_POLICIES: Record<string, string[]> = {
  admin: ["*"],
  finance_manager: ["dashboard", "invoices", "expenses", "bank", "reports", "payroll", "clients", "vendors", "settings"],
  accountant: ["dashboard", "invoices", "expenses", "reports", "clients", "vendors"],
  viewer: ["dashboard", "reports"],
};
function hasAccess(user: UserSession | undefined | null, module: string): boolean {
  if (!user || (!user.role && !user.permissions)) return true;
  const role = (user.role as Role) || "viewer";
  if (role === "admin") return true;
  if (role === "custom") {
    try { const perms: string[] = user.permissions ? JSON.parse(user.permissions) : []; return perms.includes("*") || perms.includes(module); } catch { return false; }
  }
  const policy = ROLE_POLICIES[role] || ROLE_POLICIES["viewer"];
  if (module === "settings" || module === "bank" || module === "payroll") return false;
  return policy.includes(module);
}

const PUBLIC_PATHS = [
  "/auth/signin",
  "/api/auth",
  "/api/v1",
  "/api/billing",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── CSRF Origin Validation ─────────────────────────────────────
  // For state-changing methods, verify Origin header matches allowed origins.
  // Exempt: /api/v1/ (API key auth), /api/billing/ (webhooks), /api/webhooks/ (inbound hooks)
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const csrfExempt = ["/api/v1/", "/api/billing/", "/api/webhooks/"];
    const isExempt = csrfExempt.some((p) => pathname.startsWith(p));

    if (!isExempt) {
      const origin = request.headers.get("origin");
      const allowedOrigins = [
        process.env.NEXT_PUBLIC_APP_URL,
        "http://localhost:3008",
        "http://localhost:3000",
      ].filter(Boolean);

      if (origin && !allowedOrigins.includes(origin)) {
        return NextResponse.json(
          { error: "CSRF: invalid origin" },
          { status: 403 }
        );
      }
    }
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // In development, let API calls through — route handlers have their own
    // getAuthUserId() fallback that creates a demo user
    if (process.env.NODE_ENV === "development") {
      // Mock basic admin token for fast dev without RBAC lockouts
      Object.assign(request, { token: { role: "admin" } });
    } else {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  // Enforce RBAC rules
  const topModule = pathname.split("/")[1];
  if (topModule && topModule !== "api" && topModule !== "auth") {
    const isAllowed = hasAccess((token as unknown) as UserSession, topModule);
    if (!isAllowed) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden: Missing required RBAC privileges" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  const response = NextResponse.next();

  // ── Security Headers ───────────────────────────────────────────
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-ancestors 'none';"
  );

  // Allow iframe embedding for /embed routes
  if (pathname.startsWith("/embed")) {
    response.headers.delete("X-Frame-Options");
    response.headers.set(
      "Content-Security-Policy",
      response.headers.get("Content-Security-Policy")?.replace("frame-ancestors 'none'", "frame-ancestors *") || ""
    );
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};

