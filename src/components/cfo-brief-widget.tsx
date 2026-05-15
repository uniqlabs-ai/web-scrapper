"use client";

import { useState, useEffect } from "react";
import { BarChart3, AlertTriangle, Send, ChevronDown, ChevronUp, Wallet, Receipt, TrendingUp } from "lucide-react";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/currency";

interface CFOBrief {
  companyName: string;
  period: { from: string; to: string };
  weekSummary: { totalSpend: number; topCategories: { name: string; amount: number }[]; transactionCount: number };
  monthToDate: { totalSpend: number };
  revenue: { totalFY: number; avgMonthly: number };
  receivables: { outstanding: number; overdue: number; overdueCount: number };
  cashPosition: { totalCash: number; runwayMonths: number };
  profitability: { netProfit: number; profitMargin: number };
  alerts: string[];
}

export function CFOBriefWidget() {
  const { toast } = useToast();
  const [brief, setBrief] = useState<CFOBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/reports/cfo-brief")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setBrief(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sendBrief = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/reports/cfo-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "founder@founderos.dev" }),
      });
      const data = await res.json();
      if (res.ok) toast(data.message || "CFO Brief sent!", "success");
      else toast(data.error || "Failed to send", "error");
    } catch { toast("Failed to send", "error"); }
    setSending(false);
  };

  if (loading) {
    return (
      <div style={{
        background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-color)", padding: 20, minHeight: 120,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.5 }}>
          <BarChart3 size={16} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Loading CFO Brief...</span>
        </div>
      </div>
    );
  }

  if (!brief) return null;

  const fmt = (n: number) => formatCurrency(n);
  const weekFrom = new Date(brief.period.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const weekTo = new Date(brief.period.to).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <div style={{
      background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
      border: "1px solid rgba(99, 102, 241, 0.2)", padding: 20,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #6366F1, #A855F7)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <BarChart3 size={16} color="#fff" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Weekly CFO Brief</h3>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>
              {weekFrom} – {weekTo}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={sendBrief}
            disabled={sending}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
          >
            <Send size={12} /> {sending ? "Sending..." : "Email"}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {brief.alerts.length > 0 && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, marginBottom: 12,
          background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.2)",
        }}>
          {brief.alerts.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#F59E0B", padding: "2px 0" }}>
              <AlertTriangle size={12} /> {a}
            </div>
          ))}
        </div>
      )}

      {/* Compact KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Cash</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>{fmt(brief.cashPosition.totalCash)}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {brief.cashPosition.runwayMonths >= 99 ? "∞" : `${brief.cashPosition.runwayMonths}mo`} runway
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Margin</div>
          <div style={{
            fontSize: 18, fontWeight: 800,
            color: brief.profitability.profitMargin >= 0 ? "#22C55E" : "#EF4444",
          }}>
            {brief.profitability.profitMargin}%
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{fmt(brief.profitability.netProfit)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>AR</div>
          <div style={{
            fontSize: 18, fontWeight: 800,
            color: brief.receivables.overdue > 0 ? "#EF4444" : "#3B82F6",
          }}>
            {fmt(brief.receivables.outstanding)}
          </div>
          <div style={{ fontSize: 10, color: brief.receivables.overdueCount > 0 ? "#EF4444" : "var(--text-muted)" }}>
            {brief.receivables.overdueCount} overdue
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border-color)", paddingTop: 16 }}>
          {/* This week's spend */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              <Wallet size={14} /> This Week
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--text-secondary)" }}>Spend</span>
              <span style={{ fontWeight: 700 }}>{fmt(brief.weekSummary.totalSpend)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--text-secondary)" }}>Transactions</span>
              <span style={{ fontWeight: 700 }}>{brief.weekSummary.transactionCount}</span>
            </div>
          </div>

          {/* Top categories */}
          {brief.weekSummary.topCategories.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                <Receipt size={14} /> Top Categories
              </div>
              {brief.weekSummary.topCategories.slice(0, 3).map((cat) => (
                <div key={cat.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                  <span style={{ color: "var(--text-secondary)" }}>{cat.name}</span>
                  <span style={{ fontWeight: 600 }}>{fmt(cat.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Revenue */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              <TrendingUp size={14} /> Revenue
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--text-secondary)" }}>Avg Monthly</span>
              <span style={{ fontWeight: 700 }}>{fmt(brief.revenue.avgMonthly)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--text-secondary)" }}>MTD Spend</span>
              <span style={{ fontWeight: 700 }}>{fmt(brief.monthToDate.totalSpend)}</span>
            </div>
          </div>

          <a
            href="/health"
            style={{
              display: "block", marginTop: 12, textAlign: "center",
              fontSize: 12, fontWeight: 600, color: "var(--accent-purple)",
              textDecoration: "none",
            }}
          >
            View Full Health Report →
          </a>
        </div>
      )}
    </div>
  );
}
