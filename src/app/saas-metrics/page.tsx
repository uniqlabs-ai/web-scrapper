"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Users, DollarSign, Target, Activity, Zap, ShieldCheck, ArrowUpRight, ArrowDownRight, RefreshCw } from "lucide-react";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/currency";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, BarChart, Bar } from "recharts";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ChartTooltip } from "@/components/chart-tooltip";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";

interface SaaSMetrics {
  mrr: number;
  arr: number;
  mrrGrowth: number;
  activeClients: number;
  arpu: number;
  cac: number;
  ltv: number;
  ltvCacRatio: number;
  churnRate?: number;
  nrr?: number;
}

interface TrendPoint {
  month: string;
  mrr: number;
  cacSpend: number;
  newClients: number;
}



export default function SaasMetricsPage() {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<SaaSMetrics | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/metrics/saas")
      .then(res => res.json())
      .then(d => {
        setMetrics(d.metrics || null);
        setTrends(d.trends || []);
        setAlerts(d.alerts || []);
      })
      .catch(() => toast("Failed to load SaaS Metrics", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const fmt = (n: number) => formatCurrency(n);

  if (loading) return (
    <div>
      <PageHeader title="SaaS Unit Economics" description="Real-time board-level reporting dynamically generated from your ledger" />
      <div style={{ textAlign: "center", padding: 80, color: "var(--text-secondary)" }}>Aggregating Board Metrics...</div>
    </div>
  );

  if (!metrics) return (
    <div>
      <PageHeader title="SaaS Unit Economics" description="Real-time board-level reporting dynamically generated from your ledger" />
      <EmptyState
        icon={TrendingUp}
        title="No SaaS metrics available"
        description="Import revenue data and client information to generate board-level SaaS metrics like MRR, ARR, LTV:CAC, and churn analysis."
        action={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <a href="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Import Revenue Data
            </a>
            <a href="/revenue" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              Record Revenue
            </a>
          </div>
        }
      />
    </div>
  );

  // Derived metrics
  const churnRate = metrics.churnRate ?? (metrics.activeClients > 0 ? Math.max(0, Math.round((1 - (metrics.mrrGrowth / 100 + 1)) * 100 * 10) / 10) : 0);
  const nrr = metrics.nrr ?? Math.round((1 + metrics.mrrGrowth / 100) * 100);
  const paybackMonths = metrics.cac > 0 && metrics.arpu > 0 ? Math.round(metrics.cac / metrics.arpu) : 0;
  const magicNumber = metrics.cac > 0 ? Math.round((metrics.mrr * 12 / (metrics.cac * metrics.activeClients)) * 100) / 100 : 0;

  // AI Observations
  const observations: { text: string; type: "positive" | "warning" | "info" }[] = [];
  if (metrics.ltvCacRatio >= 3) observations.push({ text: `LTV:CAC of ${metrics.ltvCacRatio.toFixed(1)}x is excellent (target: >3x). Unit economics are strong.`, type: "positive" });
  else if (metrics.ltvCacRatio < 1) observations.push({ text: `LTV:CAC of ${metrics.ltvCacRatio.toFixed(1)}x is below 1 — you're spending more to acquire than you earn. Review CAC urgently.`, type: "warning" });
  if (metrics.mrrGrowth > 20) observations.push({ text: `MRR growth of ${metrics.mrrGrowth.toFixed(1)}% is strong. Consider reinvesting in S&M.`, type: "positive" });
  if (metrics.mrrGrowth < 0) observations.push({ text: `Negative MRR growth (${metrics.mrrGrowth.toFixed(1)}%). Revenue is contracting — investigate churn.`, type: "warning" });
  if (nrr > 120) observations.push({ text: `Net Revenue Retention of ${nrr}% indicates excellent expansion revenue.`, type: "positive" });
  else if (nrr < 100) observations.push({ text: `NRR below 100% means contraction exceeds expansion. Focus on retention.`, type: "warning" });
  if (paybackMonths > 0 && paybackMonths <= 12) observations.push({ text: `CAC payback of ${paybackMonths} months is within healthy range (<12mo).`, type: "info" });
  else if (paybackMonths > 18) observations.push({ text: `CAC payback of ${paybackMonths} months is concerning. Optimize acquisition channels.`, type: "warning" });

  return (
    <div>
      <PageHeader title="SaaS Unit Economics" description="Real-time board-level reporting dynamically generated from your ledger">
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} /> Export Board Deck
          </button>
        </div>
      </PageHeader>

      {/* AI Alerts */}
      {alerts.length > 0 && (
        <div style={{
          padding: "14px 18px", borderRadius: 12, marginBottom: 20,
          background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)",
        }}>
          {alerts.map((alert, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
              color: alert.includes("WARNING") ? "#EF4444" : "#10B981", fontSize: 13, fontWeight: 600,
            }}>
              <Zap size={14} /> {alert}
            </div>
          ))}
        </div>
      )}

      {/* Primary KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card green">
          <div className="kpi-label"><TrendingUp size={14} /> MRR</div>
          <div className="kpi-value" style={{ fontSize: 24, color: "#22C55E" }}>{fmt(metrics.mrr)}</div>
          <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, marginTop: 4, color: metrics.mrrGrowth > 0 ? "#22C55E" : "#EF4444" }}>
            {metrics.mrrGrowth > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(metrics.mrrGrowth).toFixed(1)}% vs last month
          </div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label"><DollarSign size={14} /> ARR</div>
          <div className="kpi-value" style={{ fontSize: 24, color: "#F59E0B" }}>{fmt(metrics.arr)}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>MRR × 12</div>
        </div>
        <div className="kpi-card" style={{ borderColor: metrics.ltvCacRatio >= 3 ? "rgba(34,197,94,0.2)" : metrics.ltvCacRatio < 1 ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)" }}>
          <div className="kpi-label"><Target size={14} /> LTV:CAC</div>
          <div className="kpi-value" style={{ fontSize: 24, color: metrics.ltvCacRatio >= 3 ? "#22C55E" : metrics.ltvCacRatio < 1 ? "#EF4444" : "#F59E0B" }}>
            {metrics.ltvCacRatio.toFixed(1)}x
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            CAC: {fmt(metrics.cac)} · LTV: {fmt(metrics.ltv)}
          </div>
        </div>
        <div className="kpi-card" style={{ borderColor: "rgba(99,102,241,0.2)" }}>
          <div className="kpi-label"><Users size={14} /> Active Customers</div>
          <div className="kpi-value" style={{ fontSize: 24, color: "#6366F1" }}>{metrics.activeClients}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>ARPU: {fmt(metrics.arpu)}</div>
        </div>
      </div>

      {/* Secondary KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card" style={{ borderColor: nrr >= 100 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)" }}>
          <div className="kpi-label">Net Revenue Retention</div>
          <div className="kpi-value" style={{ fontSize: 22, color: nrr >= 100 ? "#22C55E" : "#EF4444" }}>{nrr}%</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Target: &gt;100%</div>
        </div>
        <div className="kpi-card" style={{ borderColor: churnRate > 5 ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)" }}>
          <div className="kpi-label">Revenue Churn</div>
          <div className="kpi-value" style={{ fontSize: 22, color: churnRate > 5 ? "#EF4444" : churnRate > 2 ? "#F59E0B" : "#22C55E" }}>
            {typeof churnRate === "number" ? `${churnRate}%` : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Monthly</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">CAC Payback</div>
          <div className="kpi-value" style={{ fontSize: 22, color: paybackMonths <= 12 ? "#22C55E" : paybackMonths <= 18 ? "#F59E0B" : "#EF4444" }}>
            {paybackMonths > 0 ? `${paybackMonths}mo` : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Target: &lt;12 months</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Magic Number</div>
          <div className="kpi-value" style={{ fontSize: 22, color: magicNumber >= 1 ? "#22C55E" : magicNumber >= 0.5 ? "#F59E0B" : "#EF4444" }}>
            {magicNumber.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>S&M efficiency</div>
        </div>
      </div>

      {/* AI Observations */}
      {observations.length > 0 && (
        <div style={{
          background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
          border: "1px solid rgba(99, 102, 241, 0.2)", padding: 20, marginBottom: 24,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: "linear-gradient(135deg, #6366F1, #A855F7)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Activity size={14} color="#fff" />
            </div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>AI Observations</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {observations.map((obs, i) => (
              <div key={i} style={{
                padding: "8px 12px", borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                background: obs.type === "positive" ? "rgba(34,197,94,0.06)" : obs.type === "warning" ? "rgba(239,68,68,0.06)" : "rgba(99,102,241,0.06)",
                borderLeft: `3px solid ${obs.type === "positive" ? "#22C55E" : obs.type === "warning" ? "#EF4444" : "#6366F1"}`,
                color: "var(--text-secondary)",
              }}>
                {obs.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="section-grid" style={{ marginBottom: 24 }}>
        {/* MRR Growth */}
        <div className="chart-container">
          <div className="chart-header"><h3>Net New MRR Growth (Trailing 12 Months)</h3></div>
          <div style={{ height: 300 }}>
            <ChartAccessibilityWrapper label="Net new MRR growth trailing 12 months" data={trends} dataKeys={["month", "mrr"]}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorMrr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#22C55E" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(val) => `₹${val / 1000}k`} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="mrr" name="MRR" stroke="#22C55E" strokeWidth={3} fillOpacity={1} fill="url(#colorMrr)" />
              </AreaChart>
            </ResponsiveContainer>
            </ChartAccessibilityWrapper>
          </div>
        </div>

        {/* CAC vs Acquisition */}
        <div className="chart-container">
          <div className="chart-header"><h3>Marketing Spend vs Acquisition</h3></div>
          <div style={{ height: 300 }}>
            <ChartAccessibilityWrapper label="Marketing spend vs new client acquisition" data={trends} dataKeys={["month", "cacSpend", "newClients"]}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(val) => `₹${val / 1000}k`} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line yAxisId="left" type="monotone" name="S&M Spend" dataKey="cacSpend" stroke="#EF4444" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="step" name="New Clients" dataKey="newClients" stroke="#6366F1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            </ChartAccessibilityWrapper>
          </div>
        </div>
      </div>
    </div>
  );
}
