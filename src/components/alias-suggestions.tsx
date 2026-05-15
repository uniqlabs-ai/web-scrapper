"use client";

import { useState, useEffect } from "react";
import { Tag, Zap, Search } from "lucide-react";

interface Suggestion {
  label: string;
  source: string;
}

interface Props {
  type: "vendor" | "payroll" | "client" | "recurring";
  currentAliases: string[];
  onAdd: (alias: string) => void;
  entityName?: string;
}

const SOURCE_BADGES: Record<string, { bg: string; color: string; label: string }> = {
  bank: { bg: "rgba(34,197,94,0.12)", color: "#22C55E", label: "Bank" },
  vendor: { bg: "rgba(99,102,241,0.12)", color: "#818CF8", label: "Vendor" },
  payroll: { bg: "rgba(249,115,22,0.12)", color: "#F97316", label: "Payroll" },
  client: { bg: "rgba(6,182,212,0.12)", color: "#06B6D4", label: "Client" },
  recurring: { bg: "rgba(168,85,247,0.12)", color: "#A855F7", label: "Recurring" },
  expense: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Expense" },
};

export function AliasSuggestions({ type, currentAliases, onAdd, entityName }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    const q = search ? `&q=${encodeURIComponent(search)}` : "";
    fetch(`/api/suggestions/aliases?type=${type}${q}`)
      .then(r => r.json())
      .then(d => setSuggestions(d.suggestions || []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [type, search, expanded]);

  // Filter out already-added aliases AND the entity's own name
  const lowerAliases = new Set(currentAliases.map(a => a.toLowerCase()));
  const lowerEntityName = entityName?.toLowerCase() || "";
  const filtered = suggestions.filter(s => {
    const lower = s.label.toLowerCase();
    if (lowerAliases.has(lower)) return false;
    if (lowerEntityName && lower === lowerEntityName) return false;
    return true;
  });

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 12px", borderRadius: 8, cursor: "pointer",
          background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
          color: "#22C55E", fontSize: 12, fontWeight: 600,
        }}
      >
        <Zap size={13} /> Smart Suggestions
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 8, padding: 12, borderRadius: 8,
      background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#22C55E" }}>
          <Zap size={13} /> Smart Suggestions
        </div>
        <button onClick={() => setExpanded(false)} style={{
          background: "none", border: "none", color: "var(--text-secondary)",
          fontSize: 11, cursor: "pointer", textDecoration: "underline",
        }}>
          Hide
        </button>
      </div>

      {/* Search filter */}
      <div style={{ position: "relative", marginBottom: 8 }}>
        <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: "var(--text-secondary)" }} />
        <input
          className="input"
          placeholder="Search bank statements, entities..."
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          style={{ paddingLeft: 28, fontSize: 12 }}
        />
      </div>

      {/* Suggestion pills */}
      {loading ? (
        <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: 0 }}>Loading suggestions...</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: 0 }}>
          {search ? "No matching suggestions" : "No suggestions available"}
        </p>
      ) : (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6,
          maxHeight: 140, overflowY: "auto",
        }}>
          {filtered.slice(0, 30).map((s) => {
            const badge = SOURCE_BADGES[s.source] || SOURCE_BADGES.bank;
            return (
              <button
                key={`${s.source}-${s.label}`}
                onClick={() => onAdd(s.label)}
                title={`Click to add as alias (from ${s.source})`}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                  background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
                  color: "var(--text-primary)", fontSize: 11, fontWeight: 500,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(ev) => {
                  (ev.target as HTMLElement).style.borderColor = badge.color;
                  (ev.target as HTMLElement).style.background = badge.bg;
                }}
                onMouseLeave={(ev) => {
                  (ev.target as HTMLElement).style.borderColor = "var(--border-color)";
                  (ev.target as HTMLElement).style.background = "var(--bg-secondary)";
                }}
              >
                <Tag size={10} style={{ color: badge.color }} />
                <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
                <span style={{
                  padding: "1px 4px", borderRadius: 3, fontSize: 9, fontWeight: 700,
                  background: badge.bg, color: badge.color,
                }}>
                  {badge.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
