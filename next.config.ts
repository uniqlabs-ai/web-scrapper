import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // ── Security Headers (defense-in-depth — also set in middleware) ──────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry build-time options
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps in production builds with auth token present
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Route handler + middleware auto-instrumentation
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,

  // Tunnel Sentry events through /monitoring to bypass ad-blockers
  tunnelRoute: "/monitoring",

  // Tree-shake Sentry debug code in production
  disableLogger: true,

  // Don't expose source maps publicly (security)
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
