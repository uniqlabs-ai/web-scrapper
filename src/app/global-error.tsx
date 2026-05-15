"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "global-error", digest: error.digest },
    });
  }, [error]);

  return (
    <html>
      <body style={{ background: "#0a0a0a", color: "#e5e5e5", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "40px 24px", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24, fontSize: 28 }}>⚠️</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#a1a1aa", fontSize: 14, maxWidth: 440, marginBottom: 32, lineHeight: 1.6 }}>
            An unexpected error occurred. Our team has been notified and is looking into it.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={reset} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Try Again
            </button>
            <button onClick={() => (window.location.href = "/")} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #27272a", background: "transparent", color: "#e5e5e5", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Dashboard
            </button>
          </div>
          {error.digest && (
            <p style={{ color: "#52525b", fontSize: 11, marginTop: 24 }}>Error ID: <code>{error.digest}</code></p>
          )}
        </div>
      </body>
    </html>
  );
}
