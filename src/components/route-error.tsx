"use client";

/**
 * RouteError — Standardized error UI for Next.js error.tsx route files.
 * 
 * Provides:
 * - Accessible error messaging with ARIA live region
 * - Contextual retry / navigate-home actions
 * - Error digest for support debugging
 * - Dev-only stack trace
 */

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home, ChevronLeft } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Page-specific context label (e.g. "Invoices", "Dashboard") */
  context?: string;
}

export function RouteError({ error, reset, context }: RouteErrorProps) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "route-error", context: context || "unknown" },
    });
  }, [error, context]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        textAlign: "center",
        minHeight: 400,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "rgba(239, 68, 68, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}
      >
        <AlertTriangle size={28} style={{ color: "#F43F5E" }} aria-hidden="true" />
      </div>

      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 8,
          color: "var(--text-primary)",
        }}
      >
        {context ? `${context} — Error` : "Something went wrong"}
      </h2>

      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: 14,
          maxWidth: 420,
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        {error.message || "An unexpected error occurred. Please try again or navigate back."}
      </p>

      {/* Dev-only details */}
      {process.env.NODE_ENV === "development" && error.stack && (
        <details
          style={{
            textAlign: "left",
            marginBottom: 24,
            padding: 12,
            background: "rgba(239, 68, 68, 0.05)",
            borderRadius: 8,
            border: "1px solid rgba(239, 68, 68, 0.2)",
            maxWidth: 600,
            width: "100%",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontSize: 12,
              color: "#ef4444",
              marginBottom: 8,
              fontWeight: 600,
            }}
          >
            Stack Trace (Dev Only)
          </summary>
          <pre
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              fontFamily: "var(--font-mono)",
            }}
          >
            {error.stack}
          </pre>
        </details>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <button
          className="btn btn-primary"
          onClick={reset}
          aria-label="Retry loading this page"
        >
          <RefreshCw size={16} aria-hidden="true" /> Try Again
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => (window.location.href = "/")}
          aria-label="Go to dashboard"
        >
          <Home size={16} aria-hidden="true" /> Dashboard
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => window.history.back()}
          aria-label="Go back to previous page"
        >
          <ChevronLeft size={16} aria-hidden="true" /> Back
        </button>
      </div>

      {error.digest && (
        <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 16 }}>
          Error ID: <code style={{ fontFamily: "var(--font-mono)" }}>{error.digest}</code>
        </p>
      )}
    </div>
  );
}
