"use client";

import { formatCurrency } from "@/lib/currency";

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  formatter?: (value: number) => string;
}

/**
 * Shared styled Recharts tooltip component.
 * Replaces 4+ duplicate `ChartTooltip` definitions across the Finance UI.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const fmt = formatter ?? ((n: number) => formatCurrency(n));

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
    >
      {label && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-secondary)",
            marginBottom: 6,
          }}
        >
          {label}
        </p>
      )}
      {payload.map((p) => (
        <p
          key={p.name}
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: p.color,
          }}
        >
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  );
}
