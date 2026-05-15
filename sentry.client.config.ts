import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",

  // Performance monitoring — 10% of client transactions
  tracesSampleRate: 0.1,

  // Session replay — only on errors, never on normal sessions
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // Mask all user inputs to prevent PII capture
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: false,
    }),
  ],

  // Ignore expected non-errors
  ignoreErrors: [
    "NEXT_NOT_FOUND",
    "NEXT_REDIRECT",
    "ResizeObserver loop",   // Browser quirk, not a real error
    "Network request failed", // Transient connectivity — not actionable
  ],
});
