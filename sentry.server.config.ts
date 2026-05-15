import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA || "0.1.0",

  // Performance monitoring — sample 20% in production, 100% in dev
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

  // Scrub sensitive financial data from breadcrumbs before sending
  beforeSend(event) {
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((b) => {
        if (b.data) {
          const sensitiveKeys = [
            "amount", "total", "salary", "bankAccount", "gstin",
            "pan", "aadhaar", "secret", "token", "password",
            "key", "authorization", "cookie",
          ];
          for (const key of sensitiveKeys) {
            if (key in b.data) b.data[key] = "[REDACTED]";
          }
        }
        return b;
      });
    }
    return event;
  },

  // Ignore expected non-errors
  ignoreErrors: [
    "NEXT_NOT_FOUND",        // Next.js notFound() — expected behavior
    "NEXT_REDIRECT",         // Next.js redirect() — expected behavior
  ],
});
