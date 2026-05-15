"use client";

import React from "react";

interface EmptyStateProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      role="status"
      style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "64px 32px",
      textAlign: "center",
      background: "var(--bg-card)",
      border: "1px dashed var(--border-color)",
      borderRadius: "var(--radius-lg)",
      margin: "24px 0",
    }}>
      <div style={{
        width: 64,
        height: 64,
        borderRadius: "var(--radius-xl)",
        background: "var(--brand-glow)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 24,
        color: "var(--brand-primary)",
      }}>
        <Icon size={32} aria-hidden="true" />
      </div>
      <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>{title}</h3>
      <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 360, marginBottom: 24 }}>
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}
