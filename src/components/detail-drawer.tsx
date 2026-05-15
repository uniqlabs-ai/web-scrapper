"use client";

import { useEffect } from "react";
import { X, TrendingUp, TrendingDown, BarChart3, PieChart as PieChartIcon, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";

const PIE_COLORS = ["#818CF8", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#A855F7", "#EC4899", "#14B8A6"];

import { formatCurrency as fmt } from "@/lib/currency";

interface Transaction {
  date: string;
  description: string;
  amount: number;
  category?: string;
  categoryColor?: string;
  currency?: string;
  matchedVia?: string | null;
}

interface MonthlyData {
  month: string;
  amount: number;
}

interface CategoryData {
  name: string;
  value: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  totalAmount: number;
  totalLabel: string;
  txnCount: number;
  trend?: "up" | "down";
  monthlyData: MonthlyData[];
  categoryData: CategoryData[];
  transactions: Transaction[];
  currency?: string;
  type?: "expense" | "revenue";
  detailUrl?: string;
}

export function DetailDrawer({
  open, onClose, title, subtitle, totalAmount, totalLabel, txnCount,
  trend, monthlyData, categoryData, transactions, currency = "INR", type = "expense",
  detailUrl,
}: Props) {
  const router = useRouter();

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  const TrendIcon = trend === "up" ? TrendingUp : TrendingDown;
  const trendColor = type === "revenue"
    ? (trend === "up" ? "#22C55E" : "#EF4444")
    : (trend === "up" ? "#EF4444" : "#22C55E");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: "min(580px, 90vw)",
      background: "var(--bg-primary)", borderLeft: "1px solid var(--border-color)",
      zIndex: 1000, display: "flex", flexDirection: "column",
      boxShadow: "-8px 0 40px rgba(0,0,0,0.3)",
      animation: "slideIn 0.2s ease-out",
    }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", top: 0, left: 0, right: "min(580px, 90vw)", bottom: 0,
          background: "rgba(0,0,0,0.3)", zIndex: -1,
        }}
      />

      {/* Header */}
      <div style={{
        padding: "20px 24px", borderBottom: "1px solid var(--border-color)",
        background: "var(--bg-card)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 id="drawer-title" style={{ margin: "0 0 4px", fontSize: 18 }}>{title}</h2>
            {subtitle && <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {detailUrl && (
          <button
            onClick={() => { onClose(); router.push(detailUrl); }}
            style={{
              marginTop: 8, display: "flex", alignItems: "center", gap: 6,
              background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: 8, padding: "6px 14px", cursor: "pointer",
              color: "#818CF8", fontSize: 12, fontWeight: 600,
            }}
          >
            <ExternalLink size={13} /> View Full Page →
          </button>
        )}

        {/* KPI row */}
        <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>{totalLabel}</div>
            <div style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
              {fmt(totalAmount, currency)}
              {trend && <TrendIcon size={16} color={trendColor} />}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>Transactions</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{txnCount}</div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {/* Monthly Trend */}
        {monthlyData.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 size={16} /> Monthly Trend
            </h3>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} width={60} />
                  <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }}
                    formatter={(v: unknown) => fmt(Number(v), currency)} />
                  <Bar dataKey="amount" fill={type === "revenue" ? "#22C55E" : "#818CF8"} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Category Breakdown */}
        {categoryData.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <PieChartIcon size={16} /> Category Breakdown
            </h3>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ width: 140, height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                      {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }}
                      formatter={(v: unknown) => fmt(Number(v), currency)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1 }}>
                {categoryData.slice(0, 6).map((c, i) => (
                  <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span style={{ color: "var(--text-secondary)" }}>{c.name}</span>
                    </div>
                    <span style={{ fontWeight: 600 }}>{fmt(c.value, currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Transaction List */}
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14 }}>
            Transactions ({transactions.length})
          </h3>
          {transactions.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No transactions found</p>
          ) : (
            <div style={{ borderRadius: 8, border: "1px solid var(--border-color)", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-secondary)" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Date</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Description</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Category</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border-color)" }}>
                      <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.description}
                        {t.matchedVia && (
                          <span style={{ marginLeft: 4, padding: "1px 5px", borderRadius: 3, fontSize: 8, fontWeight: 700, background: "rgba(249,115,22,0.15)", color: "#F97316" }}>
                            via {t.matchedVia}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {t.category && (
                          <span style={{
                            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: t.categoryColor ? `${t.categoryColor}20` : "rgba(99,102,241,0.15)",
                            color: t.categoryColor || "#818CF8",
                          }}>
                            {t.category}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12 }}>
                        {fmt(t.amount, t.currency || currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
