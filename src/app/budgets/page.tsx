"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import {
  Target,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import { useConfirm } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ChartTooltip } from "@/components/chart-tooltip";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";

interface Budget {
  id: string;
  category: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  utilization: number;
  isOverBudget: boolean;
  isWarning: boolean;
}

interface BudgetSummary {
  totalBudget: number;
  totalSpent: number;
  variance: number;
  utilizationPct: number;
}

import { formatCurrency, formatCompact } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

const fmtShort = (n: number) => formatCompact(n);



const CATEGORY_OPTIONS = [
  "Salaries", "Infrastructure", "Marketing", "Software", "Office",
  "Travel", "Food & Meals", "Professional Services", "Utilities",
  "Insurance", "Telecom & Internet", "Equipment", "Misc",
];

export default function BudgetsPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [summary, setSummary] = useState<BudgetSummary>({ totalBudget: 0, totalSpent: 0, variance: 0, utilizationPct: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formCategory, setFormCategory] = useState("");
  const [formLimit, setFormLimit] = useState("");

  async function fetchBudgets() {
    setLoading(true);
    try {
      const res = await fetch("/api/budgets");
      const data = await res.json();
      setBudgets(data.budgets || []);
      setSummary(data.summary || { totalBudget: 0, totalSpent: 0, variance: 0, utilizationPct: 0 });
    } catch (err) {
      clientLog.error("Failed to load budgets", "budgets", "load", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchBudgets(); }, []);

  async function handleCreate() {
    if (!formCategory || !formLimit) return;
    try {
      await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: formCategory, monthlyLimit: Number(formLimit) }),
      });
      setShowForm(false);
      setFormCategory("");
      setFormLimit("");
      fetchBudgets();
    } catch (err) {
      clientLog.error("Failed to create budget", "budgets", "create", err);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({ title: "Delete Budget?", message: "Are you sure you want to delete this budget? This action cannot be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      await fetch(`/api/budgets?id=${id}`, { method: "DELETE" });
      fetchBudgets();
    } catch (err) {
      clientLog.error("Failed to delete budget", "budgets", "delete", err);
    }
  }

  const chartData = budgets.map((b) => ({
    category: b.category,
    Budget: b.monthlyLimit,
    Actual: b.spent,
  }));

  const overBudgetCount = budgets.filter((b) => b.isOverBudget).length;
  const warningCount = budgets.filter((b) => b.isWarning && !b.isOverBudget).length;

  return (
    <div className="page-container">
      <PageHeader title="Budget & Forecast" description="Track spending against monthly budgets">
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Set Budget
        </button>
      </PageHeader>

      {/* Create Form */}
      {showForm && (
        <div style={{
          display: "flex", gap: 12, marginBottom: 24, padding: 20,
          background: "var(--bg-card)", borderRadius: 12,
          border: "1px solid var(--border-color)", flexWrap: "wrap", alignItems: "flex-end",
        }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Category</label>
            <select className="input" value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
              <option value="">Select category</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Monthly Limit (₹)</label>
            <input className="input" type="number" placeholder="e.g. 50000" value={formLimit} onChange={(e) => setFormLimit(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={handleCreate} disabled={!formCategory || !formLimit}>
            Save Budget
          </button>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-label"><Wallet size={14} /> Total Budget</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(summary.totalBudget)}</div>
        </div>
        <div className="kpi-card" style={{ borderColor: summary.variance >= 0 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)" }}>
          <div className="kpi-label"><TrendingDown size={14} /> Total Spent</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(summary.totalSpent)}</div>
        </div>
        <div className="kpi-card" style={{ borderColor: summary.variance >= 0 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)" }}>
          <div className="kpi-label"><TrendingUp size={14} /> Variance</div>
          <div className="kpi-value" style={{ fontSize: 22, color: summary.variance >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
            {fmt(summary.variance)}
          </div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label"><AlertTriangle size={14} /> Alerts</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>
            {overBudgetCount > 0 ? (
              <span style={{ color: "var(--accent-red)" }}>{overBudgetCount} over</span>
            ) : warningCount > 0 ? (
              <span style={{ color: "#F59E0B" }}>{warningCount} warning</span>
            ) : (
              <span style={{ color: "var(--accent-green)" }}>All OK</span>
            )}
          </div>
        </div>
      </div>

      {/* Budget vs Actual Chart */}
      {chartData.length > 0 && (
        <div className="chart-container" style={{ marginBottom: 24 }}>
          <div className="chart-header">
            <h3>Budget vs Actual</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Current month</span>
          </div>
          <div style={{ width: "100%", height: 280 }}>
            <ChartAccessibilityWrapper label="Budget vs actual spending by category this month" data={chartData} dataKeys={["category", "Budget", "Actual"]}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Budget" fill="#6366F1" radius={[4, 4, 0, 0]} barSize={20} opacity={0.4} />
                <Bar dataKey="Actual" radius={[4, 4, 0, 0]} barSize={20}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.Actual > entry.Budget ? "#F43F5E" : "#22C55E"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </ChartAccessibilityWrapper>
          </div>
        </div>
      )}

      {/* Budget Cards */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
          Loading budgets...
        </div>
      ) : budgets.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No budgets set"
          description="Click 'Set Budget' to define monthly spending limits per category"
          action={<button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Set Budget</button>}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {budgets.map((b) => (
            <div
              key={b.id}
              style={{
                padding: 20,
                background: "var(--bg-card)",
                borderRadius: 12,
                border: `1px solid ${b.isOverBudget ? "rgba(239,68,68,0.3)" : b.isWarning ? "rgba(234,179,8,0.3)" : "var(--border-color)"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 15 }}>{b.category}</h4>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {b.isOverBudget ? (
                    <AlertTriangle size={16} color="#F43F5E" />
                  ) : b.isWarning ? (
                    <AlertTriangle size={16} color="#F59E0B" />
                  ) : (
                    <CheckCircle2 size={16} color="#22C55E" />
                  )}
                  <button
                    onClick={() => handleDelete(b.id)}
                    style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 4 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{
                height: 8, borderRadius: 4, background: "var(--bg-tertiary, rgba(255,255,255,0.06))",
                overflow: "hidden", marginBottom: 12,
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(b.utilization, 100)}%`,
                  borderRadius: 4,
                  background: b.isOverBudget
                    ? "linear-gradient(90deg, #F43F5E, #EF4444)"
                    : b.isWarning
                      ? "linear-gradient(90deg, #F59E0B, #EAB308)"
                      : "linear-gradient(90deg, #22C55E, #10B981)",
                  transition: "width 0.6s ease-out",
                }} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-secondary)" }}>
                  {fmt(b.spent)} of {fmt(b.monthlyLimit)}
                </span>
                <span style={{
                  fontWeight: 600,
                  color: b.isOverBudget ? "#F43F5E" : b.isWarning ? "#F59E0B" : "#22C55E",
                }}>
                  {b.utilization}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
