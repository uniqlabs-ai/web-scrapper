"use client";

import { useState, useEffect } from "react";
import { TrendingUp, ArrowUpRight, ArrowDownRight, Plus, X, Zap, Eye } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, ReferenceLine } from "recharts";
import { PageHeader } from "@/components/page-header";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";

interface MonthData {
  month: string; label: string; revenue: number; expenses: number;
  profit: number; isForecasted?: boolean;
}

interface Scenario {
  label: string; monthlyRevenue: number; monthlyExpenses: number;
  monthlyProfit: number; annualProfit: number;
}

interface Metrics {
  avgMonthlyRevenue: number; avgMonthlyExpenses: number;
  avgMonthlyProfit: number; growthRate: number; runway: number;
}

interface WhatIfItem {
  id: string;
  label: string;
  type: "expense" | "revenue";
  amount: number;
}

const PRESETS: { label: string; type: "expense" | "revenue"; amount: number }[] = [
  { label: "Hire 1 Engineer", type: "expense", amount: 80000 },
  { label: "Hire 1 Designer", type: "expense", amount: 60000 },
  { label: "Add Cloud Infra", type: "expense", amount: 30000 },
  { label: "New SaaS Tool", type: "expense", amount: 5000 },
  { label: "Office Rent", type: "expense", amount: 50000 },
  { label: "Win New Client", type: "revenue", amount: 100000 },
  { label: "Lose a Client", type: "revenue", amount: -100000 },
  { label: "Price Increase 10%", type: "revenue", amount: 0 },
];

import { formatCurrency, formatCompact } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

export default function ForecastPage() {
  const [historical, setHistorical] = useState<MonthData[]>([]);
  const [forecast, setForecast] = useState<MonthData[]>([]);
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({});
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  // What-If state
  const [whatIfItems, setWhatIfItems] = useState<WhatIfItem[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customType, setCustomType] = useState<"expense" | "revenue">("expense");

  useEffect(() => {
    fetch("/api/forecast").then((r) => r.json()).then((data) => {
      setHistorical(data.historical || []);
      setForecast(data.forecast || []);
      setScenarios(data.scenarios || {});
      setMetrics(data.metrics || null);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // 30/60/90 outlook state
  interface OutlookSnapshot {
    label: string; days: number; projectedBalance: number;
    expectedInflows: number; expectedOutflows: number;
    risk: "green" | "amber" | "red";
  }
  const [outlook, setOutlook] = useState<OutlookSnapshot[]>([]);
  const [outlookBalance, setOutlookBalance] = useState(0);

  useEffect(() => {
    fetch("/api/reports/cashflow?view=outlook")
      .then((r) => r.json())
      .then((d) => {
        setOutlook(d.snapshots || []);
        setOutlookBalance(d.currentBalance || 0);
      })
      .catch(() => {});
  }, []);

  const allData = [...historical, ...forecast.map((f) => ({ ...f, isForecasted: true }))];

  // What-If calculations
  const whatIfExpenseDelta = whatIfItems.filter((i) => i.type === "expense").reduce((s, i) => s + i.amount, 0);
  const whatIfRevenueDelta = whatIfItems.filter((i) => i.type === "revenue").reduce((s, i) => s + i.amount, 0);
  const baseRevenue = metrics?.avgMonthlyRevenue || 0;
  const baseExpenses = metrics?.avgMonthlyExpenses || 0;
  const newRevenue = baseRevenue + whatIfRevenueDelta;
  const newExpenses = baseExpenses + whatIfExpenseDelta;
  const newProfit = newRevenue - newExpenses;
  const baseProfit = baseRevenue - baseExpenses;
  const runwayBase = metrics?.runway || 0;
  const baseBurn = baseExpenses - baseRevenue;
  const newBurn = newExpenses - newRevenue;
  const estimatedRunway = newBurn > 0 && baseBurn > 0
    ? Math.max(0, Math.round((runwayBase * baseBurn / newBurn) * 10) / 10)
    : newBurn <= 0 ? 99 : Math.max(0, runwayBase);

  const addPreset = (preset: typeof PRESETS[0]) => {
    if (preset.label === "Price Increase 10%") {
      setWhatIfItems([...whatIfItems, {
        id: crypto.randomUUID(), label: preset.label,
        type: "revenue", amount: Math.round(baseRevenue * 0.1),
      }]);
      return;
    }
    setWhatIfItems([...whatIfItems, {
      id: crypto.randomUUID(), label: preset.label,
      type: preset.type, amount: preset.amount,
    }]);
  };

  const addCustom = () => {
    if (!customLabel || !customAmount) return;
    setWhatIfItems([...whatIfItems, {
      id: crypto.randomUUID(), label: customLabel,
      type: customType, amount: Number(customAmount),
    }]);
    setCustomLabel(""); setCustomAmount("");
  };

  const removeItem = (id: string) => setWhatIfItems(whatIfItems.filter((i) => i.id !== id));

  return (
    <div>
      <PageHeader title="Financial Forecast" description="Revenue trends, cash flow modeling & scenario analysis" />

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Loading forecast...</div>
      ) : (
        <>
          {/* 30/60/90-Day Outlook */}
          {outlook.length > 0 && (
            <div style={{
              background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
              border: "1px solid rgba(99, 102, 241, 0.2)", padding: 20, marginBottom: 24,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "linear-gradient(135deg, #3B82F6, #6366F1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Eye size={16} color="#fff" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Cash Position Outlook</h3>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Projected balance at 30, 60, and 90 days based on historical averages + pending receivables</p>
                </div>
              </div>
              <div className="responsive-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {/* Current balance */}
                <div style={{
                  padding: 16, borderRadius: 12, textAlign: "center",
                  background: "rgba(34, 197, 94, 0.06)",
                  border: "1px solid rgba(34, 197, 94, 0.15)",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Today</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#22C55E" }}>{fmt(outlookBalance)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Current</div>
                </div>
                {/* 30/60/90 snapshots */}
                {outlook.map((snap) => {
                  const riskColors = { green: "#22C55E", amber: "#F59E0B", red: "#EF4444" };
                  const riskBg = { green: "rgba(34,197,94,0.06)", amber: "rgba(245,158,11,0.06)", red: "rgba(239,68,68,0.06)" };
                  const riskBorder = { green: "rgba(34,197,94,0.15)", amber: "rgba(245,158,11,0.15)", red: "rgba(239,68,68,0.15)" };
                  const delta = snap.projectedBalance - outlookBalance;
                  return (
                    <div key={snap.days} style={{
                      padding: 16, borderRadius: 12, textAlign: "center",
                      background: riskBg[snap.risk],
                      border: `1px solid ${riskBorder[snap.risk]}`,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>{snap.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: riskColors[snap.risk] }}>{fmt(snap.projectedBalance)}</div>
                      <div style={{ fontSize: 11, color: delta >= 0 ? "#22C55E" : "#EF4444", marginTop: 4 }}>
                        {delta >= 0 ? "+" : ""}{fmt(delta)}
                      </div>
                      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8, fontSize: 10, color: "var(--text-muted)" }}>
                        <span>In: {fmt(snap.expectedInflows)}</span>
                        <span>Out: {fmt(snap.expectedOutflows)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* KPIs */}
          {metrics && (
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
              <div className="kpi-card">
                <div className="kpi-label">Avg Revenue/Mo</div>
                <div className="kpi-value" style={{ fontSize: 20 }}>{fmt(metrics.avgMonthlyRevenue)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Avg Expenses/Mo</div>
                <div className="kpi-value" style={{ fontSize: 20 }}>{fmt(metrics.avgMonthlyExpenses)}</div>
              </div>
              <div className="kpi-card" style={{ borderColor: metrics.avgMonthlyProfit >= 0 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)" }}>
                <div className="kpi-label">Avg Profit/Mo</div>
                <div className="kpi-value" style={{ fontSize: 20, color: metrics.avgMonthlyProfit >= 0 ? "#22C55E" : "#EF4444" }}>{fmt(metrics.avgMonthlyProfit)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Revenue Growth</div>
                <div className="kpi-value" style={{ fontSize: 20, display: "flex", alignItems: "center", gap: 4 }}>
                  {metrics.growthRate >= 0 ? <ArrowUpRight size={18} color="#22C55E" /> : <ArrowDownRight size={18} color="#EF4444" />}
                  <span style={{ color: metrics.growthRate >= 0 ? "#22C55E" : "#EF4444" }}>{metrics.growthRate}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Revenue & Expense Trend Chart */}
          <div className="chart-container" style={{ marginBottom: 24 }}>
            <div className="chart-header"><h3>Revenue vs Expenses — 6mo history + 6mo forecast</h3></div>
            <div style={{ height: 320 }}>
              <ChartAccessibilityWrapper label="Revenue vs expenses 6 month history plus 6 month forecast" data={allData} dataKeys={["label", "revenue", "expenses"]}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={allData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#E2E8F0" }} stroke="var(--text-tertiary)" />
                  <YAxis tick={{ fontSize: 11, fill: "#E2E8F0" }} stroke="var(--text-tertiary)" tickFormatter={(v) => formatCompact(v)} />
                  <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12, color: "#E2E8F0" }} labelStyle={{ color: "#E2E8F0" }} itemStyle={{ color: "#E2E8F0" }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine x={historical[historical.length - 1]?.label} stroke="#6366F1" strokeDasharray="3 3" label={{ value: "Today", fill: "#6366F1", fontSize: 11 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#22C55E" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} opacity={0.7} />
                </BarChart>
              </ResponsiveContainer>
              </ChartAccessibilityWrapper>
            </div>
          </div>

          {/* Profit Trend Line */}
          <div className="chart-container" style={{ marginBottom: 24 }}>
            <div className="chart-header"><h3>Profit Trend & Projection</h3></div>
            <div style={{ height: 240 }}>
              <ChartAccessibilityWrapper label="Profit trend and projection" data={allData} dataKeys={["label", "profit"]}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={allData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#E2E8F0" }} stroke="var(--text-tertiary)" />
                  <YAxis tick={{ fontSize: 11, fill: "#E2E8F0" }} stroke="var(--text-tertiary)" tickFormatter={(v) => formatCompact(v)} />
                  <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12, color: "#E2E8F0" }} labelStyle={{ color: "#E2E8F0" }} itemStyle={{ color: "#E2E8F0" }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                  <ReferenceLine x={historical[historical.length - 1]?.label} stroke="#6366F1" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="profit" name="Profit" stroke="#F59E0B" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
              </ChartAccessibilityWrapper>
            </div>
          </div>

          {/* Scenario Analysis Cards */}
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
            {Object.entries(scenarios).map(([key, s]) => {
              const colors: Record<string, string> = { optimistic: "#22C55E", base: "#6366F1", conservative: "#EF4444" };
              return (
                <div key={key} className="table-container" style={{ padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors[key], display: "inline-block" }} />
                    <h4 style={{ margin: 0, fontSize: 13 }}>{s.label}</h4>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Monthly Revenue</span>
                      <span style={{ fontWeight: 600 }}>{fmt(s.monthlyRevenue)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Monthly Expenses</span>
                      <span style={{ fontWeight: 600 }}>{fmt(s.monthlyExpenses)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid var(--border-color)" }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>Monthly Profit</span>
                      <span style={{ fontWeight: 800, color: s.monthlyProfit >= 0 ? "#22C55E" : "#EF4444" }}>{fmt(s.monthlyProfit)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>Annual Projection</span>
                      <span style={{ fontWeight: 800, color: s.annualProfit >= 0 ? "#22C55E" : "#EF4444" }}>{fmt(s.annualProfit)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ═══════════════════════════════════════════ */}
          {/* What-If Scenario Simulator                 */}
          {/* ═══════════════════════════════════════════ */}
          <div style={{
            background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
            border: "1px solid rgba(99, 102, 241, 0.25)", padding: 24, marginBottom: 24,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: "linear-gradient(135deg, #6366F1, #A855F7)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Zap size={18} color="#fff" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>What-If Simulator</h3>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Model financial scenarios — see instant impact on burn, profit & runway</p>
              </div>
            </div>

            {/* Quick Presets */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Quick Add</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => addPreset(p)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500,
                      border: `1px solid ${p.type === "revenue" ? (p.amount < 0 ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)") : "rgba(249,115,22,0.3)"}`,
                      background: p.type === "revenue" ? (p.amount < 0 ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)") : "rgba(249,115,22,0.08)",
                      color: p.type === "revenue" ? (p.amount < 0 ? "#EF4444" : "#22C55E") : "#F97316",
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    <Plus size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                    {p.label}{p.amount !== 0 && ` (${fmt(Math.abs(p.amount))})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Add */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
              <select
                className="form-input"
                value={customType}
                onChange={(e) => setCustomType(e.target.value as "expense" | "revenue")}
                style={{ width: 120, fontSize: 12, padding: "6px 8px" }}
              >
                <option value="expense">+ Expense</option>
                <option value="revenue">+ Revenue</option>
              </select>
              <input
                className="form-input"
                placeholder="Label (e.g., Marketing Hire)"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}
              />
              <input
                className="form-input"
                type="number"
                placeholder="Amount per month"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                style={{ width: 140, fontSize: 12, padding: "6px 10px" }}
              />
              <button className="btn btn-primary btn-sm" onClick={addCustom} disabled={!customLabel || !customAmount}>
                <Plus size={14} /> Add
              </button>
            </div>

            {/* Active Items */}
            {whatIfItems.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Active Scenarios</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {whatIfItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                        background: item.type === "expense" ? "rgba(239, 68, 68, 0.1)" : item.amount < 0 ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)",
                        border: `1px solid ${item.type === "expense" ? "rgba(239, 68, 68, 0.25)" : item.amount < 0 ? "rgba(239, 68, 68, 0.25)" : "rgba(34, 197, 94, 0.25)"}`,
                        borderRadius: 8, fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{item.label}</span>
                      <span style={{
                        fontWeight: 700,
                        color: item.type === "expense" ? "#EF4444" : item.amount < 0 ? "#EF4444" : "#22C55E",
                      }}>
                        {item.type === "expense" ? "-" : item.amount < 0 ? "" : "+"}{fmt(Math.abs(item.amount))}/mo
                      </span>
                      <button
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove ${item.label} scenario`}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setWhatIfItems([])}
                    style={{
                      padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                      background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)",
                      color: "var(--text-muted)", cursor: "pointer",
                    }}
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}

            {/* Impact Display */}
            {whatIfItems.length > 0 && metrics && (
              <div style={{
                background: "var(--bg-primary)", borderRadius: 12, padding: 20,
                border: "1px solid var(--border-color)",
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 16 }}>
                  Scenario Impact
                </div>
                <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Monthly Revenue</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>{fmt(newRevenue)}</div>
                    {whatIfRevenueDelta !== 0 && (
                      <div style={{ fontSize: 11, color: whatIfRevenueDelta > 0 ? "#22C55E" : "#EF4444", marginTop: 2 }}>
                        {whatIfRevenueDelta > 0 ? "+" : ""}{fmt(whatIfRevenueDelta)} vs current
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Monthly Expenses</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#EF4444" }}>{fmt(newExpenses)}</div>
                    {whatIfExpenseDelta !== 0 && (
                      <div style={{ fontSize: 11, color: "#EF4444", marginTop: 2 }}>
                        +{fmt(whatIfExpenseDelta)} vs current
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Monthly Profit</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: newProfit >= 0 ? "#22C55E" : "#EF4444" }}>{fmt(newProfit)}</div>
                    <div style={{ fontSize: 11, color: (newProfit - baseProfit) >= 0 ? "#22C55E" : "#EF4444", marginTop: 2 }}>
                      {(newProfit - baseProfit) >= 0 ? "+" : ""}{fmt(newProfit - baseProfit)} vs current
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Est. Runway</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: estimatedRunway < 3 ? "#EF4444" : estimatedRunway < 6 ? "#F59E0B" : "#22C55E" }}>
                      {estimatedRunway >= 99 ? "∞" : `${estimatedRunway} mo`}
                    </div>
                    {runwayBase > 0 && estimatedRunway < 99 && (
                      <div style={{ fontSize: 11, color: estimatedRunway < runwayBase ? "#EF4444" : "#22C55E", marginTop: 2 }}>
                        {estimatedRunway < runwayBase ? "" : "+"}{(estimatedRunway - runwayBase).toFixed(1)} mo vs current
                      </div>
                    )}
                  </div>
                </div>

                {/* Comparison Bar */}
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                    <span>Current Expenses</span>
                    <span>With Scenario</span>
                  </div>
                  <div style={{ position: "relative", height: 28, background: "var(--bg-input)", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{
                      position: "absolute", top: 0, left: 0, height: "50%",
                      width: `${Math.min(100, (baseExpenses / Math.max(baseExpenses, newExpenses)) * 100)}%`,
                      background: "rgba(99, 102, 241, 0.6)", borderRadius: "6px 6px 0 0",
                      transition: "width 0.4s ease",
                    }} />
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, height: "50%",
                      width: `${Math.min(100, (newExpenses / Math.max(baseExpenses, newExpenses)) * 100)}%`,
                      background: newExpenses > baseExpenses ? "rgba(239, 68, 68, 0.6)" : "rgba(34, 197, 94, 0.6)",
                      borderRadius: "0 0 6px 6px",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                    <span style={{ color: "#6366F1" }}>{fmt(baseExpenses)}</span>
                    <span style={{ color: newExpenses > baseExpenses ? "#EF4444" : "#22C55E" }}>{fmt(newExpenses)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
