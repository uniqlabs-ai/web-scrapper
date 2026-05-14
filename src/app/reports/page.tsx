"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  FileDown,
  Calculator,
  Landmark,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { SkeletonCard } from "@/components/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type Tab = "pnl" | "cashflow" | "tax" | "aging" | "comparison";

interface PnLData {
  revenue: { label: string; amount: number }[];
  expenses: { label: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  profitMargin: number;
}

interface CashFlowData {
  projections: { month: string; inflow: number; outflow: number; net: number; balance: number }[];
  currentBalance: number;
  projectedRunway: number;
}

interface TaxData {
  outputTax: number;
  inputTaxCredit: number;
  netPayable: number;
  invoiceCount: number;
  expenseCount: number;
}

interface AgingItem {
  id: string;
  invoiceNumber: string;
  clientName: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  daysOverdue: number;
  status: string;
}

interface AgingData {
  buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  totalOutstanding: number;
  invoiceCount: number;
  items: AgingItem[];
}

const CHART_COLORS = ["#6366F1", "#A855F7", "#EC4899", "#F43F5E", "#F59E0B", "#22C55E", "#3B82F6", "#14B8A6"];

import { formatCurrency, formatCompact } from "@/lib/currency";
import { ChartTooltip } from "@/components/chart-tooltip";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";
const fmt = (n: number) => formatCurrency(n);

const fmtShort = (n: number) => formatCompact(n);



export default function ReportsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("pnl");
  const [loading, setLoading] = useState(true);
  const [pnl, setPnl] = useState<PnLData | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowData | null>(null);
  const [tax, setTax] = useState<TaxData | null>(null);
  const [aging, setAging] = useState<AgingData | null>(null);

  // Date range state
  const now = new Date();
  const [fromDate, setFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  );

  useEffect(() => {
    setLoading(true);
    const qs = `from=${fromDate}&to=${toDate}`;
    Promise.all([
      fetch(`/api/reports/pnl?${qs}`).then((r) => r.json()).catch(() => null),
      fetch("/api/reports/cashflow").then((r) => r.json()).catch(() => null),
      fetch(`/api/reports/tax?${qs}`).then((r) => r.json()).catch(() => null),
      fetch("/api/reports/aging").then((r) => r.json()).catch(() => null),
    ]).then(([p, c, t, a]) => {
      setPnl(p);
      setCashFlow(c);
      // Normalize: API returns outputTax as {cgst,sgst,igst,total} and inputTax (not inputTaxCredit)
      if (t) {
        setTax({
          outputTax: typeof t.outputTax === "object" ? (t.outputTax?.total ?? 0) : (t.outputTax ?? 0),
          inputTaxCredit: t.inputTaxCredit ?? t.inputTax ?? 0,
          netPayable: t.netPayable ?? 0,
          invoiceCount: t.invoiceCount ?? 0,
          expenseCount: t.expenseCount ?? 0,
        });
      }
      setAging(a);
      setLoading(false);
    });
  }, [fromDate, toDate]);

  const downloadCSV = () => {
    window.open(`/api/reports/pnl/csv?from=${fromDate}&to=${toDate}`, "_blank");
    toast("Downloading P&L CSV...", "info");
  };

  const downloadPDF = () => {
    window.open(`/api/reports/pdf?type=pnl&from=${fromDate}&to=${toDate}`, "_blank");
    toast("Generating PDF...", "info");
  };

  interface ComparisonData {
    period: string;
    current: { label: string; revenue: number; expenses: number; profit: number; txnCount: number };
    previous: { label: string; revenue: number; expenses: number; profit: number; txnCount: number };
    changes: { revenue: number; expenses: number; profit: number };
    categoryComparison: { category: string; current: number; previous: number; change: number }[];
  }
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  useEffect(() => {
    if (tab === "comparison") {
      fetch(`/api/reports/comparison?period=month&from=${fromDate}&to=${toDate}`)
        .then((r) => r.json()).then(setComparison).catch((err: unknown) => clientLog.error("Failed to load comparison", "reports", "comparison", err));
    }
  }, [tab, fromDate, toDate]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "pnl", label: "Profit & Loss", icon: <BarChart3 size={16} /> },
    { id: "cashflow", label: "Cash Flow", icon: <TrendingUp size={16} /> },
    { id: "tax", label: "GST Summary", icon: <Calculator size={16} /> },
    { id: "aging", label: "Aging", icon: <Landmark size={16} /> },
    { id: "comparison", label: "Comparison", icon: <DollarSign size={16} /> },
  ];

  // Tax pie data
  const taxPieData = tax ? [
    { name: "Output Tax", value: tax.outputTax, color: "#F59E0B" },
    { name: "Input Credit", value: tax.inputTaxCredit, color: "#22C55E" },
  ] : [];

  return (
    <div>
      <PageHeader title="Reports" description="Financial intelligence and reporting">
        {tab === "pnl" && (
          <>
            <button className="btn btn-secondary" onClick={downloadCSV}>
              <FileDown size={16} /> Export CSV
            </button>
            <button className="btn btn-secondary" onClick={downloadPDF}>
              <FileDown size={16} /> Export PDF
            </button>
          </>
        )}
      </PageHeader>

      {/* Tab navigation */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 24,
        background: "var(--bg-secondary)", padding: 4,
        borderRadius: "var(--radius)", width: "fit-content",
      }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: "var(--radius-sm)",
              border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer",
              transition: "all 0.2s",
              background: tab === t.id ? "var(--bg-card)" : "transparent",
              color: tab === t.id ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Period Selector Pills + Date Picker */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 12, marginBottom: 20,
      }}>
        {/* Quick-select pills */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["MTD", "QTD", "YTD", "Custom"] as const).map((pill) => {
            const isActive = (() => {
              const n = new Date();
              const mStart = new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
              const qStart = new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
              const yStart = new Date(n.getFullYear(), 0, 1).toISOString().slice(0, 10);
              const today = n.toISOString().slice(0, 10);
              if (pill === "MTD") return fromDate === mStart && toDate === today;
              if (pill === "QTD") return fromDate === qStart && toDate === today;
              if (pill === "YTD") return fromDate === yStart && toDate === today;
              return false;
            })();
            return (
              <button
                key={pill}
                onClick={() => {
                  const n = new Date();
                  const today = n.toISOString().slice(0, 10);
                  if (pill === "MTD") {
                    setFromDate(new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10));
                    setToDate(today);
                  } else if (pill === "QTD") {
                    setFromDate(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1).toISOString().slice(0, 10));
                    setToDate(today);
                  } else if (pill === "YTD") {
                    setFromDate(new Date(n.getFullYear(), 0, 1).toISOString().slice(0, 10));
                    setToDate(today);
                  }
                  // Custom: no auto-set, user picks manually
                }}
                style={{
                  padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: "1px solid",
                  borderColor: isActive ? "var(--accent-purple)" : "var(--border-color)",
                  background: isActive ? "rgba(139, 92, 246, 0.15)" : "transparent",
                  color: isActive ? "var(--accent-purple)" : "var(--text-secondary)",
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                {pill === "MTD" ? "Month to Date" : pill === "QTD" ? "Quarter to Date" : pill === "YTD" ? "Year to Date" : "Custom"}
              </button>
            );
          })}
        </div>

        {/* Date pickers */}
        <div style={{
          display: "flex", gap: 12, alignItems: "center",
          padding: "10px 16px", background: "var(--bg-card)", borderRadius: 10,
          border: "1px solid var(--border-color)", width: "fit-content",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Period:</span>
          <input
            type="date" value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <span style={{ color: "var(--text-tertiary)" }}>→</span>
          <input
            type="date" value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: 16 }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <>
          {/* P&L Tab */}
          {tab === "pnl" && pnl && (
            <>
              {/* Summary KPIs */}
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
                <div className="kpi-card green">
                  <div className="kpi-label">Total Revenue</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(pnl.totalRevenue)}</div>
                </div>
                <div className="kpi-card red">
                  <div className="kpi-label">Total Expenses</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(pnl.totalExpenses)}</div>
                </div>
                <div className="kpi-card" style={{ borderColor: pnl.netIncome >= 0 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)" }}>
                  <div className="kpi-label">Net Income</div>
                  <div className="kpi-value" style={{ fontSize: 22, color: pnl.netIncome >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {fmt(pnl.netIncome)}
                  </div>
                </div>
                <div className="kpi-card amber">
                  <div className="kpi-label">Profit Margin</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{pnl.profitMargin.toFixed(1)}%</div>
                </div>
              </div>

              {/* Revenue vs Expenses Chart */}
              <div className="section-grid" style={{ marginBottom: 24 }}>
                <div className="chart-container">
                  <div className="chart-header">
                    <h3><DollarSign size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Revenue Breakdown</h3>
                  </div>
                  {pnl.revenue.length > 0 ? (
                    <div style={{ width: "100%", height: 240 }}>
                      <ChartAccessibilityWrapper label="Revenue breakdown by category" data={pnl.revenue} dataKeys={["label", "amount"]}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={pnl.revenue} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: "var(--text-primary)" }} width={100} axisLine={false} tickLine={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="amount" name="Revenue" fill="#22C55E" radius={[0, 6, 6, 0]} barSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                      </ChartAccessibilityWrapper>
                    </div>
                  ) : (
                    <div className="empty-state" style={{ padding: 40 }}>
                      <p style={{ color: "var(--text-muted)" }}>No revenue data</p>
                    </div>
                  )}
                </div>

                <div className="chart-container">
                  <div className="chart-header">
                    <h3><Landmark size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Expense Breakdown</h3>
                  </div>
                  {pnl.expenses.length > 0 ? (
                    <div style={{ width: "100%", height: 240 }}>
                      <ChartAccessibilityWrapper label="Expense breakdown by category" data={pnl.expenses} dataKeys={["label", "amount"]}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={pnl.expenses} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: "var(--text-primary)" }} width={100} axisLine={false} tickLine={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="amount" name="Expense" radius={[0, 6, 6, 0]} barSize={20}>
                            {pnl.expenses.map((_: unknown, i: number) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      </ChartAccessibilityWrapper>
                    </div>
                  ) : (
                    <div className="empty-state" style={{ padding: 40 }}>
                      <p style={{ color: "var(--text-muted)" }}>No expense data</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Cash Flow Tab */}
          {tab === "cashflow" && cashFlow && (
            <>
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
                <div className="kpi-card green">
                  <div className="kpi-label">Current Balance</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(cashFlow.currentBalance)}</div>
                </div>
                <div className="kpi-card" style={{ borderColor: cashFlow.projectedRunway > 12 ? "rgba(34,197,94,0.2)" : "rgba(234,179,8,0.2)" }}>
                  <div className="kpi-label">Projected Runway</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>
                    {cashFlow.projectedRunway === Infinity ? "∞" : `${cashFlow.projectedRunway} months`}
                  </div>
                </div>
                <div className="kpi-card amber">
                  <div className="kpi-label">Projection Period</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{cashFlow.projections.length} months</div>
                </div>
              </div>

              {/* Cash Flow AreaChart */}
              <div className="chart-container" style={{ marginBottom: 24 }}>
                <div className="chart-header">
                  <h3>Monthly Cash Flow</h3>
                </div>
                {cashFlow.projections.length > 0 ? (
                  <div style={{ width: "100%", height: 280 }}>
                    <ChartAccessibilityWrapper label="Monthly cash flow inflow vs outflow" data={cashFlow.projections} dataKeys={["month", "inflow", "outflow", "net", "balance"]}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cashFlow.projections} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22C55E" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#F43F5E" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v) => v.split(" ")[0]} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                        <Area type="monotone" dataKey="inflow" name="Inflow" stroke="#22C55E" strokeWidth={2} fill="url(#inflowGrad)" dot={{ r: 3, fill: "#22C55E", strokeWidth: 0 }} />
                        <Area type="monotone" dataKey="outflow" name="Outflow" stroke="#F43F5E" strokeWidth={2} fill="url(#outflowGrad)" dot={{ r: 3, fill: "#F43F5E", strokeWidth: 0 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                    </ChartAccessibilityWrapper>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: 40 }}>
                    <p style={{ color: "var(--text-muted)" }}>No projections available</p>
                  </div>
                )}
              </div>

              {/* Cash Flow Table */}
              <div className="table-container">
                <div className="table-header"><h3>Monthly Breakdown</h3></div>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col" style={{ textAlign: "right" }}>Inflow</th>
                      <th scope="col" style={{ textAlign: "right" }}>Outflow</th>
                      <th scope="col" style={{ textAlign: "right" }}>Net</th>
                      <th scope="col" style={{ textAlign: "right" }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashFlow.projections.map((p) => (
                      <tr key={p.month}>
                        <td style={{ fontWeight: 600 }}>{p.month}</td>
                        <td style={{ textAlign: "right", color: "var(--accent-green)" }}>{fmt(p.inflow)}</td>
                        <td style={{ textAlign: "right", color: "var(--accent-red)" }}>{fmt(p.outflow)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: p.net >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>{fmt(p.net)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(p.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Tax Tab */}
          {tab === "tax" && tax && (
            <>
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
                <div className="kpi-card amber">
                  <div className="kpi-label">Output Tax (Collected)</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(tax.outputTax)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>From {tax.invoiceCount} invoices</div>
                </div>
                <div className="kpi-card green">
                  <div className="kpi-label">Input Tax Credit</div>
                  <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(tax.inputTaxCredit)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>From {tax.expenseCount} expenses</div>
                </div>
                <div className="kpi-card" style={{ borderColor: tax.netPayable > 0 ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)" }}>
                  <div className="kpi-label">Net GST Payable</div>
                  <div className="kpi-value" style={{ fontSize: 22, color: tax.netPayable > 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
                    {fmt(tax.netPayable)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {tax.netPayable > 0 ? "Payable to government" : "Credit available"}
                  </div>
                </div>
              </div>

              <div className="section-grid">
                {/* GST Pie Chart */}
                <div className="chart-container">
                  <div className="chart-header"><h3>GST Breakdown</h3></div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 200, height: 200 }}>
                      <ChartAccessibilityWrapper label="GST breakdown by component" data={taxPieData} dataKeys={["name", "value"]}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={taxPieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={4}
                            strokeWidth={0}
                          >
                            {taxPieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => fmt(Number(value))} />
                          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      </ChartAccessibilityWrapper>
                    </div>
                  </div>
                </div>

                {/* GST Computation */}
                <div className="table-container" style={{ padding: 24 }}>
                  <h3 style={{ marginBottom: 16 }}>GST Computation</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border-color)" }}>
                      <span>Output Tax (on sales)</span>
                      <span style={{ fontWeight: 600 }}>{fmt(tax.outputTax)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border-color)" }}>
                      <span>Less: Input Tax Credit</span>
                      <span style={{ fontWeight: 600, color: "var(--accent-green)" }}>- {fmt(tax.inputTaxCredit)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0", fontSize: 18, fontWeight: 800 }}>
                      <span>Net GST Payable</span>
                      <span style={{ color: tax.netPayable > 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
                        {fmt(tax.netPayable)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Aging Tab — Enhanced Analysis */}
          {tab === "aging" && aging && (() => {
            // DSO calculation
            const dso = aging.totalOutstanding > 0 && aging.items.length > 0
              ? Math.round(aging.items.reduce((sum, i) => sum + i.daysOverdue * i.balance, 0) / aging.totalOutstanding)
              : 0;

            // At-risk amount (trending toward 90+)
            const atRisk = aging.items
              .filter((i) => i.daysOverdue >= 61)
              .reduce((sum, i) => sum + i.balance, 0);

            // Per-client breakdown
            const clientMap = new Map<string, { balance: number; count: number; avgDays: number }>();
            for (const item of aging.items) {
              const existing = clientMap.get(item.clientName) || { balance: 0, count: 0, avgDays: 0 };
              existing.balance += item.balance;
              existing.count++;
              existing.avgDays = Math.round((existing.avgDays * (existing.count - 1) + item.daysOverdue) / existing.count);
              clientMap.set(item.clientName, existing);
            }
            const clientBreakdown = Array.from(clientMap.entries())
              .map(([name, data]) => ({ name, ...data }))
              .sort((a, b) => b.balance - a.balance);

            // Waterfall chart data
            const bucketData = [
              { name: "Current", value: aging.buckets.current, color: "#22C55E" },
              { name: "1-30d", value: aging.buckets.d1_30, color: "#F59E0B" },
              { name: "31-60d", value: aging.buckets.d31_60, color: "#F97316" },
              { name: "61-90d", value: aging.buckets.d61_90, color: "#EF4444" },
              { name: "90+d", value: aging.buckets.d90_plus, color: "#DC2626" },
            ];

            return (
              <>
                {/* Summary KPIs */}
                <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
                  <div className="kpi-card amber">
                    <div className="kpi-label">Total Outstanding</div>
                    <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(aging.totalOutstanding)}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{aging.invoiceCount} invoices</div>
                  </div>
                  <div className="kpi-card" style={{ borderColor: "rgba(99, 102, 241, 0.2)" }}>
                    <div className="kpi-label">Days Sales Outstanding</div>
                    <div className="kpi-value" style={{ fontSize: 22, color: dso > 45 ? "#EF4444" : dso > 30 ? "#F59E0B" : "#22C55E" }}>{dso}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>weighted avg days</div>
                  </div>
                  <div className="kpi-card" style={{ borderColor: "rgba(239, 68, 68, 0.2)" }}>
                    <div className="kpi-label">At-Risk (61+ days)</div>
                    <div className="kpi-value" style={{ fontSize: 22, color: atRisk > 0 ? "#EF4444" : "#22C55E" }}>{fmt(atRisk)}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {aging.totalOutstanding > 0 ? Math.round((atRisk / aging.totalOutstanding) * 100) : 0}% of total
                    </div>
                  </div>
                  <div className="kpi-card green">
                    <div className="kpi-label">Collection Rate</div>
                    <div className="kpi-value" style={{ fontSize: 22 }}>
                      {aging.totalOutstanding > 0 ? Math.round(((aging.buckets.current) / aging.totalOutstanding) * 100) : 100}%
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>current vs outstanding</div>
                  </div>
                </div>

                {/* Aging Waterfall Chart */}
                <div className="chart-container" style={{ marginBottom: 24 }}>
                  <div className="chart-header"><h3>Aging Distribution</h3></div>
                  <div style={{ width: "100%", height: 240 }}>
                    <ChartAccessibilityWrapper label="Accounts receivable aging distribution" data={bucketData} dataKeys={["name", "value"]}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={bucketData} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Outstanding" radius={[6, 6, 0, 0]} barSize={40}>
                          {bucketData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    </ChartAccessibilityWrapper>
                  </div>
                </div>

                <div className="section-grid" style={{ marginBottom: 24 }}>
                  {/* Per-Client Breakdown */}
                  <div className="table-container">
                    <div className="table-header"><h3>Slow Payers (By Client)</h3></div>
                    {clientBreakdown.length > 0 ? (
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Client</th>
                            <th scope="col" style={{ textAlign: "center" }}>Invoices</th>
                            <th scope="col" style={{ textAlign: "center" }}>Avg Days</th>
                            <th scope="col" style={{ textAlign: "right" }}>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientBreakdown.slice(0, 8).map((c) => (
                            <tr key={c.name}>
                              <td style={{ fontWeight: 600 }}>{c.name}</td>
                              <td style={{ textAlign: "center" }}>{c.count}</td>
                              <td style={{ textAlign: "center" }}>
                                <span style={{
                                  padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                                  background: c.avgDays <= 30 ? "rgba(34,197,94,0.15)" : c.avgDays <= 60 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                                  color: c.avgDays <= 30 ? "#22C55E" : c.avgDays <= 60 ? "#F59E0B" : "#EF4444",
                                }}>
                                  {c.avgDays}d
                                </span>
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(c.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No client data</div>
                    )}
                  </div>

                  {/* Bucket cards */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {bucketData.map((b) => {
                      const pct = aging.totalOutstanding > 0 ? Math.round((b.value / aging.totalOutstanding) * 100) : 0;
                      return (
                        <div key={b.name} style={{
                          padding: "14px 16px", borderRadius: 10,
                          background: b.value > 0 ? `${b.color}10` : "var(--bg-card)",
                          border: `1px solid ${b.value > 0 ? `${b.color}30` : "var(--border-color)"}`,
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: "50%", background: b.color }} />
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{b.name}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{pct}%</span>
                            <span style={{ fontSize: 15, fontWeight: 800, color: b.value > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                              {b.value > 0 ? fmt(b.value) : "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Detailed invoice table */}
                {aging.items.length > 0 && (
                  <div className="table-container">
                    <div className="table-header"><h3>Invoice Details</h3></div>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Invoice</th>
                          <th scope="col">Client</th>
                          <th scope="col">Due Date</th>
                          <th scope="col" style={{ textAlign: "right" }}>Total</th>
                          <th scope="col" style={{ textAlign: "right" }}>Paid</th>
                          <th scope="col" style={{ textAlign: "right" }}>Balance</th>
                          <th scope="col" style={{ textAlign: "center" }}>Days Overdue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aging.items.map((item) => (
                          <tr key={item.id}>
                            <td style={{ fontWeight: 600 }}>{item.invoiceNumber}</td>
                            <td>{item.clientName}</td>
                            <td>{new Date(item.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                            <td style={{ textAlign: "right" }}>{fmt(item.total)}</td>
                            <td style={{ textAlign: "right", color: "var(--accent-green)" }}>{fmt(item.paid)}</td>
                            <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(item.balance)}</td>
                            <td style={{ textAlign: "center" }}>
                              <span style={{
                                padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                                background: item.daysOverdue === 0 ? "rgba(34,197,94,0.15)" :
                                  item.daysOverdue <= 30 ? "rgba(245,158,11,0.15)" :
                                    item.daysOverdue <= 60 ? "rgba(249,115,22,0.15)" : "rgba(239,68,68,0.15)",
                                color: item.daysOverdue === 0 ? "#22C55E" :
                                  item.daysOverdue <= 30 ? "#F59E0B" :
                                    item.daysOverdue <= 60 ? "#F97316" : "#EF4444",
                              }}>
                                {item.daysOverdue === 0 ? "Current" : `${item.daysOverdue}d`}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* Comparison Tab */}
      {tab === "comparison" && (
        <div className="table-container" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>Period Comparison</h3>
          {comparison ? (
            <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div className="kpi-card">
                <div className="kpi-label">Revenue Change</div>
                <div className="kpi-value" style={{ fontSize: 18, color: (comparison.changes.revenue || 0) >= 0 ? "#22C55E" : "#EF4444" }}>
                  {(comparison.changes.revenue || 0) >= 0 ? "+" : ""}{comparison.changes.revenue || 0}%
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Expense Change</div>
                <div className="kpi-value" style={{ fontSize: 18, color: (comparison.changes.expenses || 0) <= 0 ? "#22C55E" : "#EF4444" }}>
                  {(comparison.changes.expenses || 0) >= 0 ? "+" : ""}{comparison.changes.expenses || 0}%
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Profit Change</div>
                <div className="kpi-value" style={{ fontSize: 18, color: (comparison.changes.profit || 0) >= 0 ? "#22C55E" : "#EF4444" }}>
                  {(comparison.changes.profit || 0) >= 0 ? "+" : ""}{comparison.changes.profit || 0}%
                </div>
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--text-secondary)" }}>Loading comparison data...</p>
          )}
        </div>
      )}
    </div>
  );
}
