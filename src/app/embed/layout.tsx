import React from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import Providers from "../providers";
import "../globals.css";

// A clean, sidebar-less layout specifically built for B2B iframe embedding
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
      {/* 
        This layout intentionally omits the <AppShell> which contains the 
        sidebar and top navigation. In a B2B embedded context, the tenant's
        own CRM provides the navigation.
      */}
      <ErrorBoundary>
        <Providers>
          <main style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            {children}
          </main>
        </Providers>
      </ErrorBoundary>
    </div>
  );
}
