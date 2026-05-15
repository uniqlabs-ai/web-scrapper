"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import { Heart, TrendingUp, TrendingDown, Wallet, Receipt, AlertTriangle, CheckCircle2, RefreshCw, ArrowRight, BarChart3, Mail, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";

interface Financials {
  totalRevenue: number; totalExpenses: number; netProfit: number; profitMargin: number;
  avgMonthlyRevenue: number; avgMonthlyExpenses: number; revenueGrowth: number;
  totalCash: number; runwayMonths: string | number; totalReceivables: number;
  totalOverdue: number; avgDaysToCollect: number;
}

interface TopCategory { name: string; amount: number; pct: number; }

interface Recommendation {
  priority: string; category: string; title: string;
  description: string; impact: string; action: string;
}

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

const PRIORITY_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
  critical: { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.25)", color: "#EF4444", label: "CRITICAL" },
  high: { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.25)", color: "#F59E0B", label: "HIGH" },
  medium: { bg: "rgba(99,102,241,0.06)", border: "rgba(99,102,241,0.2)", color: "#6366F1", label: "MEDIUM" },
  low: { bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.2)", color: "#22C55E", label: "LOW" },
};

export default function HealthPage() {
  const [score, setScore] = useState(0);
  const [grade, setGrade] = useState("");
  const [gradeColor, setGradeColor] = useState("#666");
  const [financials, setFinancials] = useState<Financials | null>(null);
  const [topCats, setTopCats] = useState<TopCategory[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [dataPoints, setDataPoints] = useState({ revenueMonths: 0, expenseRecords: 0, invoiceCount: 0, bankAccounts: 0 });
  const [loading, setLoading] = useState(true);
  const [animatedScore, setAnimatedScore] = useState(0);

  // CFO Brief state
  interface CfoBrief {
    companyName: string;
    weekSummary: { totalSpend: number; topCategories: { name: string; amount: number }[]; transactionCount: number };
    monthToDate: { totalSpend: number };
    cashPosition: { totalCash: number; runwayMonths: number };
    profitability: { netProfit: number; profitMargin: number };
    receivables: { outstanding: number; overdue: number; overdueCount: number };
    alerts: string[];
  }
  const [cfoBrief, setCfoBrief] = useState<CfoBrief | null>(null);
  const [cfoEmail, setCfoEmail] = useState("");
  const [sendingCfo, setSendingCfo] = useState(false);
  const [cfoSent, setCfoSent] = useState(false);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((data) => {
      if (data && !data.error) {
        setScore(data.score || 0);
        setGrade(data.grade || "?");
        setGradeColor(data.gradeColor || "#666");
        setFinancials(data.financials || null);
        setTopCats(data.topCategories || []);
        setRecs(data.recommendations || []);
        setDataPoints(data.dataPoints || {});
      }
    }).catch((err: unknown) => clientLog.error("Failed to load health data", "health", "load", err)).finally(() => setLoading(false));
    fetch("/api/reports/cfo-brief").then((r) => r.json()).then((d) => {
      if (d && d.weekSummary && d.cashPosition) setCfoBrief(d);
    }).catch(() => {});
  }, []);

  // Animated score counter
  useEffect(() => {
    if (score === 0) return;
    let current = 0;
    const step = Math.max(1, Math.floor(score / 40));
    const interval = setInterval(() => {
      current += step;
      if (current >= score) { current = score; clearInterval(interval); }
      setAnimatedScore(current);
    }, 30);
    return () => clearInterval(interval);
  }, [score]);

  const circumference = 2 * Math.PI * 80;
  const dashOffset = circumference - (animatedScore / 100) * circumference;

  return (
    <div>
      <PageHeader title="Financial Health" description="Comprehensive health score with AI-powered recommendations">
        <button className="btn btn-secondary" onClick={() => window.location.reload()} style={{ fontSize: 12, padding: "6px 14px" }}>
          <RefreshCw size={14} /> Re-analyze
        </button>
      </PageHeader>

      {loading ? (
        <div style={{ textAlign: "center", padding: 80, color: "var(--text-secondary)" }}>Analyzing your financial data...</div>
      ) : (
        <>
          {/* Health Score + Grade */}
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, marginBottom: 32 }}>
            {/* Score Circle */}
            <div style={{
              background: "var(--bg-card)", borderRadius: 16, border: "1px solid var(--border-color)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32,
            }}>
              <svg width="180" height="180" viewBox="0 0 180 180" style={{ marginBottom: 12 }}>
                <circle cx="90" cy="90" r="80" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
                <circle cx="90" cy="90" r="80" fill="none" stroke={gradeColor} strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={circumference} strokeDashoffset={dashOffset}
                  transform="rotate(-90 90 90)" style={{ transition: "stroke-dashoffset 0.5s ease" }}
                />
                <text x="90" y="82" textAnchor="middle" fill={gradeColor} fontSize="42" fontWeight="800">{animatedScore}</text>
                <text x="90" y="105" textAnchor="middle" fill="var(--text-secondary)" fontSize="13">/100</text>
              </svg>
              <div style={{
                padding: "6px 20px", borderRadius: 8, fontSize: 18, fontWeight: 900,
                background: `${gradeColor}15`, color: gradeColor, letterSpacing: 2,
              }}>
                Grade: {grade}
              </div>
            </div>

            {/* Key Metrics */}
            {financials && (
              <div className="responsive-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <div className="kpi-card">
                  <div className="kpi-label"><TrendingUp size={14} color="#22C55E" /> Total Revenue (FY)</div>
                  <div className="kpi-value" style={{ fontSize: 18, color: "#22C55E" }}>{fmt(financials.totalRevenue)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    {financials.revenueGrowth >= 0 ? "↑" : "↓"} {Math.abs(financials.revenueGrowth)}% growth
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label"><TrendingDown size={14} color="#EF4444" /> Total Expenses (FY)</div>
                  <div className="kpi-value" style={{ fontSize: 18, color: "#EF4444" }}>{fmt(financials.totalExpenses)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    {fmt(financials.avgMonthlyExpenses)}/mo avg
                  </div>
                </div>
                <div className="kpi-card" style={{ borderColor: financials.netProfit >= 0 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)" }}>
                  <div className="kpi-label">{financials.netProfit >= 0 ? <Wallet size={14} style={{ display: "inline", verticalAlign: "middle" }} /> : <AlertTriangle size={14} style={{ display: "inline", verticalAlign: "middle" }} />} Net {financials.netProfit >= 0 ? "Profit" : "Loss"}</div>
                  <div className="kpi-value" style={{ fontSize: 18, color: financials.netProfit >= 0 ? "#22C55E" : "#EF4444" }}>
                    {fmt(Math.abs(financials.netProfit))}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    {financials.profitMargin}% margin
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label"><Wallet size={14} /> Cash Position</div>
                  <div className="kpi-value" style={{ fontSize: 18 }}>{fmt(financials.totalCash)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    {financials.runwayMonths == null ? "N/A" : financials.runwayMonths === "∞" || financials.runwayMonths === Infinity ? "∞" : financials.runwayMonths} months runway
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label"><Receipt size={14} /> Receivables</div>
                  <div className="kpi-value" style={{ fontSize: 18 }}>{fmt(financials.totalReceivables)}</div>
                  <div style={{ fontSize: 11, color: financials.totalOverdue > 0 ? "#F59E0B" : "var(--text-tertiary)", marginTop: 4 }}>
                    {financials.totalOverdue > 0 ? `${fmt(financials.totalOverdue)} overdue` : "All current"}
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label"><BarChart3 size={14} style={{ display: "inline", verticalAlign: "middle" }} /> Collection Days</div>
                  <div className="kpi-value" style={{ fontSize: 18 }}>
                    {financials.avgDaysToCollect > 0 ? `${financials.avgDaysToCollect}d` : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    Target: &lt;30 days
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Top Expense Categories */}
          {topCats.length > 0 && (
            <div className="table-container" style={{ padding: 20, marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 14 }}>Top Expense Categories</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topCats.map((cat) => (
                  <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 140, fontSize: 13, fontWeight: 500 }}>{cat.name}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.05)" }}>
                      <div style={{ width: `${cat.pct}%`, height: "100%", borderRadius: 4, background: "linear-gradient(90deg, #6366F1, #A855F7)", transition: "width 0.5s ease" }} />
                    </div>
                    <span style={{ width: 100, textAlign: "right", fontSize: 13, fontWeight: 600 }}>{fmt(cat.amount)}</span>
                    <span style={{ width: 40, textAlign: "right", fontSize: 11, color: "var(--text-tertiary)" }}>{cat.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={18} /> AI Recommendations ({recs.length})
            </h3>
            {recs.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, background: "var(--bg-card)", borderRadius: 12, border: "1px solid rgba(34,197,94,0.2)" }}>
                <CheckCircle2 size={32} color="#22C55E" style={{ marginBottom: 8 }} />
                <p style={{ margin: 0, color: "#22C55E", fontWeight: 600 }}>No issues detected. Your finances look great!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {recs.map((rec, i) => {
                  const style = PRIORITY_STYLES[rec.priority] || PRIORITY_STYLES.medium;
                  return (
                    <div key={i} style={{
                      padding: "18px 22px", borderRadius: 12, borderLeft: `4px solid ${style.color}`,
                      background: style.bg, border: `1px solid ${style.border}`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{rec.title}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${style.color}22`, color: style.color }}>{style.label}</span>
                          <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>{rec.category}</span>
                        </div>
                      </div>
                      <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{rec.description}</p>
                      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-tertiary)", fontStyle: "italic" }}>Impact: {rec.impact}</p>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <ArrowRight size={12} color={style.color} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{rec.action}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Weekly CFO Brief */}
          {cfoBrief && (
            <div style={{
              marginBottom: 24, padding: 24, borderRadius: 16,
              background: "var(--bg-card)", border: "1px solid rgba(99, 102, 241, 0.2)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: "linear-gradient(135deg, #6366F1, #A855F7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Mail size={18} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Weekly CFO Brief</h3>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Automated executive summary of your financial position</p>
                </div>
              </div>

              {/* Brief Preview */}
              <div className="responsive-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                <div style={{ padding: 14, borderRadius: 10, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.12)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>This Week</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{fmt(cfoBrief.weekSummary.totalSpend)}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{cfoBrief.weekSummary.transactionCount} txns</div>
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Cash Position</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>{fmt(cfoBrief.cashPosition.totalCash)}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{cfoBrief.cashPosition.runwayMonths >= 99 ? "∞" : cfoBrief.cashPosition.runwayMonths + "mo"} runway</div>
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: cfoBrief.profitability.profitMargin >= 0 ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${cfoBrief.profitability.profitMargin >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)"}` }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Margin</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: cfoBrief.profitability.profitMargin >= 0 ? "#22C55E" : "#EF4444" }}>{cfoBrief.profitability.profitMargin}%</div>
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: cfoBrief.receivables.overdue > 0 ? "rgba(245,158,11,0.06)" : "rgba(99,102,241,0.06)", border: `1px solid ${cfoBrief.receivables.overdue > 0 ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.12)"}` }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Outstanding AR</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: cfoBrief.receivables.overdue > 0 ? "#F59E0B" : "var(--text-primary)" }}>{fmt(cfoBrief.receivables.outstanding)}</div>
                  {cfoBrief.receivables.overdueCount > 0 && <div style={{ fontSize: 10, color: "#F59E0B" }}>{cfoBrief.receivables.overdueCount} overdue</div>}
                </div>
              </div>

              {/* Alerts */}
              {cfoBrief.alerts.length > 0 && (
                <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                  {cfoBrief.alerts.map((a, i) => (
                    <div key={i} style={{ fontSize: 12, padding: "3px 0", color: "var(--text-secondary)" }}>{a}</div>
                  ))}
                </div>
              )}

              {/* Top categories this week */}
              {cfoBrief.weekSummary.topCategories.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Top spend this week</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {cfoBrief.weekSummary.topCategories.map((c) => (
                      <span key={c.name} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)" }}>
                        {c.name}: {fmt(c.amount)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Send Email */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="email"
                  className="form-input"
                  placeholder="founder@company.com"
                  value={cfoEmail}
                  onChange={(e) => { setCfoEmail(e.target.value); setCfoSent(false); }}
                  style={{ flex: 1, fontSize: 13, padding: "8px 12px" }}
                />
                <button
                  className="btn btn-primary"
                  disabled={!cfoEmail || sendingCfo || cfoSent}
                  onClick={async () => {
                    setSendingCfo(true);
                    try {
                      const res = await fetch("/api/reports/cfo-brief", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: cfoEmail }),
                      });
                      if (res.ok) setCfoSent(true);
                    } catch (e) { clientLog.warn("Non-critical error", "health", "parse-impact", e); }
                    setSendingCfo(false);
                  }}
                  style={{ padding: "8px 16px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Send size={12} />
                  {cfoSent ? "Sent ✓" : sendingCfo ? "Sending..." : "Send Brief"}
                </button>
              </div>
            </div>
          )}

          {/* Data Sources */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "12px 16px", background: "var(--bg-card)", borderRadius: 10, border: "1px solid var(--border-color)", fontSize: 12, color: "var(--text-tertiary)" }}>
            <span><BarChart3 size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Data used:</span>
            <span>{dataPoints.revenueMonths} revenue months</span>·
            <span>{dataPoints.expenseRecords} expenses</span>·
            <span>{dataPoints.invoiceCount} invoices</span>·
            <span>{dataPoints.bankAccounts} bank accounts</span>
          </div>
        </>
      )}
    </div>
  );
}
