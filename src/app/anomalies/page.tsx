"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import { AlertTriangle, RefreshCw, Shield, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { formatCurrency } from "@/lib/currency";

interface Anomaly {
  type: string; severity: string; title: string;
  description: string; amount?: number; threshold?: number;
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; color: string; icon: string }> = {
  high: { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.2)", color: "#EF4444", icon: "HIGH" },
  medium: { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.2)", color: "#F59E0B", icon: "MED" },
  low: { bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.2)", color: "#22C55E", icon: "LOW" },
};

export default function AnomaliesPage() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [summary, setSummary] = useState({ total: 0, high: 0, medium: 0, low: 0 });
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true);
    setDismissed(new Set());
    try {
      const res = await fetch("/api/anomalies");
      const data = await res.json();
      setAnomalies(data.anomalies || []);
      setSummary(data.summary || { total: 0, high: 0, medium: 0, low: 0 });
    } catch (err) { clientLog.error("Failed to load anomalies", "anomalies", "load", err); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const activeAnomalies = anomalies.filter((_, i) => !dismissed.has(i));
  const activeCount = activeAnomalies.length;
  const resolvedCount = dismissed.size;

  // Severity distribution for mini bar
  const severityBar = [
    { key: "high", count: anomalies.filter((a, i) => !dismissed.has(i) && a.severity === "high").length, color: "#EF4444" },
    { key: "medium", count: anomalies.filter((a, i) => !dismissed.has(i) && a.severity === "medium").length, color: "#F59E0B" },
    { key: "low", count: anomalies.filter((a, i) => !dismissed.has(i) && a.severity === "low").length, color: "#22C55E" },
  ];
  const totalActive = severityBar.reduce((s, b) => s + b.count, 0);

  return (
    <div>
      <PageHeader title="Anomaly Detection" description="AI-powered spending pattern analysis and budget alerts">
        <div style={{ display: "flex", gap: 8 }}>
          {resolvedCount > 0 && (
            <span style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: "rgba(34,197,94,0.1)", color: "#22C55E",
            }}>
              <CheckCircle size={12} /> {resolvedCount} resolved
            </span>
          )}
          <button className="btn btn-secondary" onClick={load} style={{ fontSize: 12, padding: "6px 14px" }}>
            <RefreshCw size={14} /> Re-scan
          </button>
        </div>
      </PageHeader>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card" style={{ borderColor: activeCount > 0 ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.2)" }}>
          <div className="kpi-label">Active Alerts</div>
          <div className="kpi-value" style={{ fontSize: 28, color: activeCount > 0 ? "var(--text-primary)" : "#22C55E" }}>{activeCount}</div>
          {/* Severity distribution bar */}
          {totalActive > 0 && (
            <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", marginTop: 8, gap: 1 }}>
              {severityBar.map((b) => b.count > 0 && (
                <div key={b.key} style={{ width: `${(b.count / totalActive) * 100}%`, background: b.color, borderRadius: 1 }} />
              ))}
            </div>
          )}
        </div>
        <div className="kpi-card" style={{ borderColor: "rgba(239,68,68,0.2)" }}>
          <div className="kpi-label">High</div>
          <div className="kpi-value" style={{ fontSize: 28, color: "#EF4444" }}>
            {anomalies.filter((a, i) => !dismissed.has(i) && a.severity === "high").length}
          </div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label">Medium</div>
          <div className="kpi-value" style={{ fontSize: 28, color: "#F59E0B" }}>
            {anomalies.filter((a, i) => !dismissed.has(i) && a.severity === "medium").length}
          </div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Low</div>
          <div className="kpi-value" style={{ fontSize: 28, color: "#22C55E" }}>
            {anomalies.filter((a, i) => !dismissed.has(i) && a.severity === "low").length}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Scanning spending patterns...</div>
      ) : activeAnomalies.length === 0 ? (
        <div style={{ textAlign: "center", padding: 80, background: "var(--bg-card)", borderRadius: 16, border: "1px solid rgba(34,197,94,0.2)" }}>
          <Shield size={48} style={{ opacity: 0.3, marginBottom: 16, color: "#22C55E" }} />
          <h3 style={{ margin: "0 0 8px", color: "#22C55E" }}>All Clear</h3>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            {resolvedCount > 0
              ? `${resolvedCount} anomalies resolved this session. No remaining issues.`
              : "No spending anomalies detected. Your finances look healthy!"}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {anomalies.map((a, i) => {
            if (dismissed.has(i)) return null;
            const style = SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.low;
            const isExpanded = expanded.has(i);
            return (
              <div key={i} style={{
                borderRadius: 12,
                background: style.bg, border: `1px solid ${style.border}`,
                borderLeft: `4px solid ${style.color}`,
                overflow: "hidden",
              }}>
                {/* Header */}
                <div style={{
                  padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center",
                  cursor: "pointer",
                }} onClick={() => {
                  const next = new Set(expanded);
                  isExpanded ? next.delete(i) : next.add(i);
                  setExpanded(next);
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                    <AlertTriangle size={16} color={style.color} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{a.title}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                        textTransform: "uppercase", background: `${style.color}22`, color: style.color,
                      }}>
                        {a.severity}
                      </span>
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)",
                      }}>
                        {a.type.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {a.amount != null && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: style.color }}>
                        {formatCurrency(a.amount)}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding: "0 18px 14px" }}>
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      {a.description}
                    </p>
                    {a.threshold != null && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                        Threshold: {formatCurrency(a.threshold)}
                        {a.amount != null && ` · Exceeded by ${formatCurrency(a.amount - a.threshold)}`}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-primary"
                        style={{ padding: "6px 14px", fontSize: 12 }}
                        onClick={(e) => { e.stopPropagation(); window.location.href = "/expenses"; }}
                      >
                        Review Expenses →
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: "6px 14px", fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = new Set(dismissed);
                          next.add(i);
                          setDismissed(next);
                        }}
                      >
                        <XCircle size={12} /> Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
