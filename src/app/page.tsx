"use client";

import { useState, useEffect } from "react";
import {
  TrendingUp,
  Flame,
  Clock,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  DollarSign,
  CreditCard,
  PieChart as PieChartIcon,
  BarChart3,
  AlertTriangle,
  Bell,
  ArrowRight,
} from "lucide-react";
import { SkeletonKPI } from "@/components/skeleton";
import { StaggerContainer, SlideUp, HoverScale, FadeIn } from "@/components/animations";
import { EmptyState } from "@/components/empty-state";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { CFOBriefWidget } from "@/components/cfo-brief-widget";
import { ChartTooltip } from "@/components/chart-tooltip";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";

interface DashboardData {
  monthlyRevenue: number;
  totalMonthlyRevenue: number;
  burnRate: number;
  runwayMonths: number;
  outstandingInvoices: { count: number; total: number };
  totalExpensesThisMonth: number;
  revenueGrowth: number;
  burnRateDetails: { trend: string; average3Month: number };
  runway: { projectedRunOutDate?: string; cashInBank: number };
  revenueDetails: { currentARR: number; currentMRR: number; history: { month: string; amount: number }[] };
}

interface CashFlowData {
  projections: { month: string; inflow: number; outflow: number; net: number; balance: number }[];
  currentBalance: number;
  projectedRunway: number;
}

interface PnLData {
  expenses: { label: string; amount: number }[];
  totalExpenses: number;
}

const CHART_COLORS = ["#6366F1", "#A855F7", "#EC4899", "#F59E0B", "#22C5E", "#3B82F6"];

import { formatCurrency, formatCompact } from "@/lib/currency";

const formatINR = (n: number) => formatCurrency(n);

const fmtShort = (n: number) => formatCompact(n);



export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowData | null>(null);
  const [pnl, setPnl] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<{ id: string; type: string; title: string; message: string; action?: string; actionUrl?: string }[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard").then((res) => res.json()).catch(() => null),
      fetch("/api/reports/cashflow").then((res) => res.json()).catch(() => null),
      fetch("/api/reports/pnl").then((res) => res.json()).catch(() => null),
      fetch("/api/alerts").then((res) => res.json()).catch(() => ({ alerts: [] })),
    ]).then(([dashData, cfData, pnlData, alertData]) => {
      if (dashData && !dashData.error) setData(dashData);
      if (cfData && !cfData.error) setCashFlow(cfData);
      if (pnlData && !pnlData.error) setPnl(pnlData);
      setAlerts(alertData?.alerts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h2>Dashboard</h2>
          <p>Your financial overview at a glance</p>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => <SkeletonKPI key={i} />)}
        </div>
      </div>
    );
  }

  // Detect empty database — all financial data is zero/empty
  const isEmptyDb = !data ||
    ((data.totalMonthlyRevenue ?? data.monthlyRevenue ?? 0) === 0 &&
     (data.burnRate ?? 0) === 0 &&
     (data.outstandingInvoices?.count ?? 0) === 0 &&
     (data.totalExpensesThisMonth ?? 0) === 0);

  if (isEmptyDb) {
    return (
      <div>
        <div className="page-header">
          <SlideUp delay={0.1}>
            <h2>Dashboard</h2>
            <p>Your financial overview at a glance</p>
          </SlideUp>
        </div>
        <EmptyState
          icon={TrendingUp}
          title="Welcome to Finance Suite!"
          description="Import a bank statement or add your first invoice to see your financial overview come to life."
          action={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <a href="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                <ArrowRight size={16} /> Go to Import
              </a>
              <a href="/invoices?new=1" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                <FileText size={16} /> Create Invoice
              </a>
            </div>
          }
        />
      </div>
    );
  }

  const kpis = [
    {
      label: "Monthly Revenue",
      value: formatINR(data?.totalMonthlyRevenue ?? data?.monthlyRevenue ?? 0),
      change: data?.revenueGrowth ?? 0,
      color: "green" as const,
      icon: <TrendingUp size={20} />,
      sub: `MRR ${formatINR(data?.revenueDetails?.currentMRR ?? 0)} · ARR ${formatINR(data?.revenueDetails?.currentARR ?? 0)}`,
    },
    {
      label: "Burn Rate",
      value: formatINR(data?.burnRate ?? 0),
      change: null,
      color: "red" as const,
      icon: <Flame size={20} />,
      sub: `Trend: ${data?.burnRateDetails?.trend ?? "stable"}`,
    },
    {
      label: "Runway",
      value: data?.runwayMonths == null ? "N/A" : data?.runwayMonths === Infinity ? "∞" : `${data.runwayMonths} mo`,
      change: null,
      color: (data?.runwayMonths ?? 0) > 12
        ? "green" as const
        : (data?.runwayMonths ?? 0) > 6
          ? "amber" as const
          : "red" as const,
      icon: <Clock size={20} />,
      sub: data?.runway?.projectedRunOutDate
        ? `Until ${new Date(data.runway.projectedRunOutDate).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`
        : "Sustainable",
    },
    {
      label: "Outstanding",
      value: `${data?.outstandingInvoices?.count ?? 0}`,
      change: null,
      color: "amber" as const,
      icon: <FileText size={20} />,
      sub: formatINR(data?.outstandingInvoices?.total ?? 0),
    },
  ];

  const history = data?.revenueDetails?.history ?? [];
  const cfProjections = cashFlow?.projections ?? [];
  const expenseCategories = (pnl?.expenses ?? []).slice(0, 6);
  const expTotal = pnl?.totalExpenses || 1;

  // Pie chart data
  const pieData = expenseCategories.map((cat, i) => ({
    name: cat.label,
    value: cat.amount,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div>
      <div className="page-header">
        <SlideUp delay={0.1}>
          <h2>Dashboard</h2>
          <p>Your financial overview at a glance</p>
        </SlideUp>
      </div>

      {/* KPI Grid */}
      <StaggerContainer className="kpi-grid" delay={0.08}>
        {kpis.map((kpi, idx) => (
          <SlideUp key={kpi.label} delay={idx * 0.05}>
            <HoverScale className={`kpi-card ${kpi.color}`}>
              <div className={`kpi-icon ${kpi.color}`}>{kpi.icon}</div>
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value">{kpi.value}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {kpi.change !== null && (
                  <span className={`kpi-change ${kpi.change > 0 ? "up" : kpi.change < 0 ? "down" : "neutral"}`}>
                    {kpi.change > 0 ? <ArrowUpRight size={12} /> : kpi.change < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}
                    {Math.abs(kpi.change)}%
                  </span>
                )}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{kpi.sub}</span>
              </div>
            </HoverScale>
          </SlideUp>
        ))}
      </StaggerContainer>

      {/* Smart Alerts */}
      {alerts.length > 0 && (
        <FadeIn delay={0.2}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Bell size={16} color="var(--accent-amber)" />
              <span style={{ fontSize: 14, fontWeight: 600 }}>Smart Alerts</span>
              <span style={{ fontSize: 11, background: "var(--accent-red-glow)", color: "var(--accent-red)", padding: "2px 8px", borderRadius: 12, fontWeight: 600 }}>{alerts.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {alerts.map((alert) => {
                const colors = {
                  danger: { bg: "rgba(255, 71, 87, 0.08)", border: "rgba(255, 71, 87, 0.25)", icon: "var(--accent-red)" },
                  warning: { bg: "rgba(240, 165, 0, 0.08)", border: "rgba(240, 165, 0, 0.25)", icon: "var(--accent-amber)" },
                  info: { bg: "rgba(78, 154, 241, 0.08)", border: "rgba(78, 154, 241, 0.25)", icon: "var(--accent-blue)" },
                };
                const c = colors[alert.type as keyof typeof colors] || colors.info;
                return (
                  <div key={alert.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 16px", borderRadius: 10,
                    background: c.bg, border: `1px solid ${c.border}`,
                  }}>
                    <AlertTriangle size={16} color={c.icon} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{alert.title}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{alert.message}</div>
                    </div>
                    {alert.actionUrl && (
                      <HoverScale>
                        <a href={alert.actionUrl} style={{
                          fontSize: 12, fontWeight: 600, color: c.icon,
                          display: "flex", alignItems: "center", gap: 4,
                          textDecoration: "none", whiteSpace: "nowrap",
                        }}>
                          {alert.action} <ArrowRight size={12} />
                        </a>
                      </HoverScale>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </FadeIn>
      )}

      {/* Charts Row 1: Revenue Trend + Quick Actions */}
      <StaggerContainer className="section-grid" delay={0.1}>
        <SlideUp className="chart-container" delay={0.3}>
          <div className="chart-header">
            <h3><DollarSign size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Revenue Trend</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Last 6 months</span>
          </div>
          {history.length > 0 ? (
            <div style={{ width: "100%", height: 220 }}>
              <ChartAccessibilityWrapper label="Revenue trend over last 6 months" data={history} dataKeys={["month", "amount"]}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v) => v.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="amount" name="Revenue" stroke="#6366F1" strokeWidth={2.5} fill="url(#revenueGrad)" dot={{ r: 4, fill: "#6366F1", strokeWidth: 0 }} activeDot={{ r: 6 }} />
                </AreaChart>
              </ResponsiveContainer>
              </ChartAccessibilityWrapper>
            </div>
          ) : (
            <EmptyState
              icon={DollarSign}
              title="No revenue data yet"
              description="Record revenue to see your history and trends over time."
            />
          )}
        </SlideUp>

        <SlideUp className="chart-container" delay={0.4}>
          <CFOBriefWidget />
        </SlideUp>
      </StaggerContainer>

      {/* Charts Row 2: Cash Flow Projection + Expense Breakdown */}
      <StaggerContainer className="section-grid" delay={0.2}>
        <SlideUp className="chart-container" delay={0.5}>
          <div className="chart-header">
            <h3><BarChart3 size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Cash Flow Projection</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Next 6 months</span>
          </div>
          {cfProjections.length > 0 ? (
            <div style={{ width: "100%", height: 220 }}>
              <ChartAccessibilityWrapper label="Cash flow projection for next 6 months" data={cfProjections} dataKeys={["month", "inflow", "outflow"]}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cfProjections} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v) => v.split(" ")[0]} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="inflow" name="Inflow" fill="#22C55E" radius={[4, 4, 0, 0]} barSize={16} />
                  <Bar dataKey="outflow" name="Outflow" fill="#F43F5E" radius={[4, 4, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
              </ChartAccessibilityWrapper>
            </div>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No projection data"
              description="Import your bank statements to see automatic cash flow projections."
            />
          )}
        </SlideUp>

        <SlideUp className="chart-container" delay={0.6}>
          <div className="chart-header">
            <h3><PieChartIcon size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Top Expenses</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>This month</span>
          </div>
          {pieData.length > 0 ? (
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ width: 140, height: 140, flexShrink: 0 }}>
                <ChartAccessibilityWrapper label="Top expense categories this month" data={pieData} dataKeys={["name", "value"]}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={60}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatINR(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
                </ChartAccessibilityWrapper>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {expenseCategories.map((cat, i) => {
                  const pct = Math.round((cat.amount / expTotal) * 100);
                  return (
                    <div key={cat.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: CHART_COLORS[i % CHART_COLORS.length], display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontWeight: 500 }}>{cat.label}</span>
                      </span>
                      <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={PieChartIcon}
              title="No expenses this month"
              description="Record expenses to see your top spending categories."
            />
          )}
        </SlideUp>
      </StaggerContainer>
    </div>
  );
}
