"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import { CalendarDays, AlertTriangle, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface Deadline {
  date: string;
  type: string;
  title: string;
  description: string;
  status: "upcoming" | "due_today" | "overdue" | "completed";
  priority: "high" | "medium" | "low";
}

interface Summary {
  overdue: number;
  dueToday: number;
  upcoming: number;
  total: number;
}

const TYPE_COLORS: Record<string, string> = {
  GST: "#F59E0B",
  TDS: "#6366F1",
  "Income Tax": "#EC4899",
  Receivable: "#22C55E",
};

export default function CompliancePage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [summary, setSummary] = useState<Summary>({ overdue: 0, dueToday: 0, upcoming: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch("/api/compliance/calendar")
      .then((r) => r.json())
      .then((data) => {
        setDeadlines(data.deadlines || []);
        setSummary(data.summary || { overdue: 0, dueToday: 0, upcoming: 0, total: 0 });
      })
      .catch((err: unknown) => clientLog.error("Failed to load compliance data", "compliance", "load", err))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all"
    ? deadlines
    : filter === "overdue"
      ? deadlines.filter((d) => d.status === "overdue")
      : deadlines.filter((d) => d.type === filter);

  const types = [...new Set(deadlines.map((d) => d.type))];

  return (
    <div>
      <PageHeader title="Compliance Calendar" description="Tax deadlines, filing dates, and financial obligations" />

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card" style={{ borderColor: summary.overdue > 0 ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.2)" }}>
          <div className="kpi-label">Overdue</div>
          <div className="kpi-value" style={{ fontSize: 28, color: summary.overdue > 0 ? "#EF4444" : "#22C55E" }}>
            {summary.overdue}
          </div>
        </div>
        <div className="kpi-card" style={{ borderColor: summary.dueToday > 0 ? "rgba(245,158,11,0.3)" : "var(--border-color)" }}>
          <div className="kpi-label">Due Today</div>
          <div className="kpi-value" style={{ fontSize: 28, color: summary.dueToday > 0 ? "#F59E0B" : "var(--text-primary)" }}>
            {summary.dueToday}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Upcoming</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{summary.upcoming}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Events</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{summary.total}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap",
      }}>
        {["all", "overdue", ...types].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 14px", borderRadius: 6, border: "none", fontSize: 12,
              fontWeight: 600, cursor: "pointer",
              background: filter === f ? "var(--accent-primary)" : "var(--bg-secondary)",
              color: filter === f ? "#fff" : "var(--text-secondary)",
            }}
          >
            {f === "all" ? "All" : f === "overdue" ? `Overdue (${summary.overdue})` : f}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Loading calendar...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All clear!"
          description="No items match this filter"
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((d, i) => {
            const isOverdue = d.status === "overdue";
            const isDueToday = d.status === "due_today";
            const typeColor = TYPE_COLORS[d.type] || "#64748B";

            return (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "14px 20px", background: "var(--bg-card)", borderRadius: 10,
                  border: `1px solid ${isOverdue ? "rgba(239,68,68,0.25)" : isDueToday ? "rgba(245,158,11,0.25)" : "var(--border-color)"}`,
                  borderLeft: `4px solid ${isOverdue ? "#EF4444" : isDueToday ? "#F59E0B" : typeColor}`,
                }}
              >
                {/* Status Icon */}
                <div style={{ flexShrink: 0 }}>
                  {isOverdue ? <AlertTriangle size={18} color="#EF4444" /> :
                    isDueToday ? <AlertCircle size={18} color="#F59E0B" /> :
                      <Clock size={18} color="var(--text-tertiary)" />}
                </div>

                {/* Date */}
                <div style={{ width: 80, flexShrink: 0, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>
                    {new Date(d.date).getDate()}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    {new Date(d.date).toLocaleDateString("en-IN", { month: "short" })}
                  </div>
                </div>

                {/* Content */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{
                      padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                      background: `${typeColor}20`, color: typeColor,
                    }}>
                      {d.type}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>{d.description}</p>
                </div>

                {/* Status badge */}
                <div style={{ flexShrink: 0 }}>
                  <span style={{
                    padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: isOverdue ? "rgba(239,68,68,0.12)" : isDueToday ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.08)",
                    color: isOverdue ? "#EF4444" : isDueToday ? "#F59E0B" : "#22C55E",
                  }}>
                    {isOverdue ? "OVERDUE" : isDueToday ? "TODAY" : "UPCOMING"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
