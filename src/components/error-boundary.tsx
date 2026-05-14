"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { clientLog } from "@/lib/client-logger";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    clientLog.error("ErrorBoundary caught an error", "error-boundary", "catch", error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: 60, textAlign: "center",
          minHeight: 300,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "rgba(239, 68, 68, 0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 16,
          }}>
            <AlertTriangle size={24} style={{ color: "#F43F5E" }} />
          </div>
          <h3 style={{ marginBottom: 8 }}>Something went wrong</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: 16, maxWidth: 400, fontSize: 13 }}>
            {this.state.error?.message || "An unexpected error occurred. Please try refreshing."}
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            <RefreshCw size={14} /> Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
