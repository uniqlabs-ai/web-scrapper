"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Wallet } from "lucide-react";

export default function SignInPage() {
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    await signIn("google", { callbackUrl: "/" });
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg-primary)",
      padding: 20,
    }}>
      <div style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-xl)",
        padding: 48,
        maxWidth: 420,
        width: "100%",
        textAlign: "center",
      }}>
        <div style={{
          width: 64,
          height: 64,
          background: "linear-gradient(135deg, var(--brand-primary), var(--accent-green))",
          borderRadius: "var(--radius-lg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 32,
          margin: "0 auto 24px",
          boxShadow: "var(--shadow-glow)",
        }}>
          <Wallet size={32} color="#fff" />
        </div>

        <h1 style={{
          fontSize: 28,
          fontWeight: 800,
          marginBottom: 8,
          letterSpacing: -0.5,
        }}>
          Finance
        </h1>

        <p style={{
          color: "var(--text-secondary)",
          fontSize: 15,
          marginBottom: 32,
          lineHeight: 1.6,
        }}>
          Invoicing, expenses, runway & financial intelligence for your startup
        </p>

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={{
            width: "100%",
            padding: "14px 24px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius)",
            color: "var(--text-primary)",
            fontSize: 15,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            transition: "var(--transition)",
            opacity: loading ? 0.6 : 1,
            minHeight: 48,
            fontFamily: "var(--font-sans)",
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.borderColor = "var(--brand-primary)";
              e.currentTarget.style.boxShadow = "0 0 0 3px var(--brand-glow)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-color)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {loading ? "Signing in..." : "Continue with Google"}
        </button>

        <p style={{
          color: "var(--text-muted)",
          fontSize: 12,
          marginTop: 24,
        }}>
          Part of Founder OS
        </p>
      </div>
    </div>
  );
}
