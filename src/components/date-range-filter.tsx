"use client";

import { useState, useCallback } from "react";
import { Calendar, ChevronDown } from "lucide-react";

interface DateRange {
  from: string;
  to: string;
  label: string;
}

interface Props {
  onChange: (range: DateRange) => void;
  defaultPreset?: string;
}

const thisYear = new Date().getFullYear();

const PRESETS: { label: string; from: string; to: string }[] = [
  { label: "This Year", from: `${thisYear}-01-01`, to: new Date().toISOString().slice(0, 10) },
  { label: "Last Year", from: `${thisYear - 1}-01-01`, to: `${thisYear - 1}-12-31` },
  { label: "All Time", from: "", to: "" },
];

export function DateRangeFilter({ onChange, defaultPreset = "All Time" }: Props) {
  const [active, setActive] = useState(defaultPreset);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const select = useCallback((label: string, from: string, to: string) => {
    setActive(label);
    setShowCustom(false);
    onChange({ from, to, label });
  }, [onChange]);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, marginBottom: 20,
      flexWrap: "wrap",
    }}>
      <Calendar size={14} style={{ color: "var(--text-secondary)" }} />
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => select(p.label, p.from, p.to)}
          style={{
            padding: "5px 14px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600,
            cursor: "pointer", transition: "all 0.15s",
            background: active === p.label ? "rgba(99,102,241,0.2)" : "var(--bg-secondary)",
            color: active === p.label ? "#818CF8" : "var(--text-secondary)",
          }}
        >
          {p.label}
        </button>
      ))}
      <button
        onClick={() => setShowCustom(!showCustom)}
        style={{
          padding: "5px 14px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
          background: active === "Custom" ? "rgba(99,102,241,0.2)" : "var(--bg-secondary)",
          color: active === "Custom" ? "#818CF8" : "var(--text-secondary)",
        }}
      >
        Custom <ChevronDown size={12} />
      </button>
      {showCustom && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            style={{
              padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-color)",
              background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 12,
            }}
          />
          <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            style={{
              padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-color)",
              background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 12,
            }}
          />
          <button
            onClick={() => {
              if (customFrom || customTo) {
                select("Custom", customFrom, customTo);
              }
            }}
            style={{
              padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 600,
              background: "rgba(99,102,241,0.2)", color: "#818CF8", cursor: "pointer",
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

/** Helper: build query string with from/to params */
export function dateQueryParams(range: DateRange): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
