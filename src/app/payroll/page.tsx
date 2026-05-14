"use client";

import { useState, useEffect } from "react";

import { Users, Plus, X, Play, DollarSign, Sparkles, Check, EyeOff, UserCheck, Briefcase, PieChart as PieChartIcon, BarChart3, Send } from "lucide-react";
import { useToast } from "@/components/toast";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { DetailDrawer } from "@/components/detail-drawer";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTable, ColumnDef } from "@/components/data-table";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";

interface Employee {
  id: string; employeeId: string; name: string; email: string;
  designation: string; department: string; basicSalary: number;
  hra: number; ctc: number; isActive: boolean;
  type: string; paymentBasis: string | null;
}

interface DetectedPayroll {
  name: string; avgAmount: number; count: number; distinctMonths: number;
  variance: number; isConsistent: boolean; frequency: string;
  kind: string; confidence: number;
}

interface PayrollEntry {
  id: string; employeeId: string; name: string; designation: string;
  status: string; grossPay: number; pfEmployee: number; esiEmployee: number;
  professionalTax: number; tds: number; totalDeductions: number; netPay: number;
}

interface PayrollSummary {
  totalGross: number; totalDeductions: number; totalNet: number;
  totalPfEmployer: number; totalEsiEmployer: number; employeeCount: number; companyCost: number;
}

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

export default function PayrollPage() {
  const { toast } = useToast();

  const [view, setView] = useState("employees");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<PayrollEntry[]>([]);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // Suggestions from bank data
  const [suggestions, setSuggestions] = useState<DetectedPayroll[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [basicSalary, setBasicSalary] = useState("");
  const [hra, setHra] = useState("");
  const [ctc, setCtc] = useState("");
  const [addType, setAddType] = useState("employee");

  // Detail drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerData, setDrawerData] = useState<{
    entityId: string; title: string; subtitle?: string; totalAmount: number; txnCount: number;
    monthlyData: { month: string; amount: number }[];
    categoryData: { name: string; value: number }[];
    transactions: { date: string; description: string; amount: number; category?: string; categoryColor?: string }[];
  } | null>(null);

  // Date range
  const [dateRange, setDateRange] = useState({ from: "", to: "", label: "All Time" });

  async function loadEmployees() {
    setLoading(true);
    const params = new URLSearchParams({ view: "employees" });
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    const res = await fetch(`/api/payroll?${params}`);
    const data = await res.json();
    setEmployees(data.employees || []);
    setLoading(false);
  }

  async function loadRuns() {
    setLoading(true);
    const params = new URLSearchParams({ view: "runs", month });
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    const res = await fetch(`/api/payroll?${params}`);
    const data = await res.json();
    setRuns(data.runs || []);
    setSummary(data.summary || null);
    setLoading(false);
  }

  useEffect(() => { if (view === "employees") loadEmployees(); else loadRuns(); }, [view, month, dateRange]);

  // Load suggestions + dismissed
  useEffect(() => {
    try {
      const stored = localStorage.getItem("dismissed_payroll");
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
    fetch("/api/detect-recurring").then(r => r.json()).then(data => {
      setSuggestions(data.payroll || []);
    }).catch(console.error);
  }, [employees]);

  async function addEmployee() {
    if (!name || !basicSalary) return;
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_employee", name, email, designation, department,
          basicSalary: Number(basicSalary), hra: Number(hra) || 0,
          ctc: Number(ctc) || Number(basicSalary) * 12,
          type: addType,
          paymentBasis: addType === "contractor" ? "milestone" : "fixed",
        }),
      });
      if (!res.ok) { toast("Failed to add", "error"); return; }
      toast(`${addType === "contractor" ? "Contractor" : "Employee"} added`, "success");
      setShowForm(false);
      setName(""); setEmail(""); setDesignation(""); setDepartment("");
      setBasicSalary(""); setHra(""); setCtc(""); setAddType("employee");
      loadEmployees();
    } catch { toast("Failed", "error"); }
  }

  async function acceptPayrollSuggestion(s: DetectedPayroll, acceptType: string) {
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_employee",
          name: s.name,
          basicSalary: s.avgAmount,
          ctc: s.avgAmount * 12,
          type: acceptType,
          paymentBasis: s.isConsistent ? "fixed" : "milestone",
        }),
      });
      if (!res.ok) { toast("Failed", "error"); return; }
      toast(`"${s.name}" added as ${acceptType}`, "success");
      loadEmployees();
    } catch { toast("Failed", "error"); }
  }

  function dismissPayroll(name: string) {
    const next = new Set(dismissed);
    next.add(name);
    setDismissed(next);
    try { localStorage.setItem("dismissed_payroll", JSON.stringify([...next])); } catch { /* ignore */ }
  }

  const visibleSuggestions = suggestions.filter(s => !dismissed.has(s.name));

  async function runPayroll() {
    setProcessing(true);
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_payroll", month }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Failed", "error"); return; }
      toast(`Payroll processed for ${data.processed} employees`, "success");
      setView("payroll");
      loadRuns();
    } catch { toast("Failed", "error"); }
    finally { setProcessing(false); }
  }

  async function payPayroll() {
    setProcessing(true);
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pay_payroll", month }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Failed to route payment", "error"); return; }
      toast(`Direct deposit initiated for ${data.paid} employees.`, "success");
      loadRuns();
    } catch { toast("Failed", "error"); }
    finally { setProcessing(false); }
  }

  async function openEmployeeDetail(e: Employee) {
    try {
      const res = await fetch(`/api/payroll/${e.id}`);
      const data = await res.json();
      setDrawerData({
        entityId: e.id,
        title: e.name,
        subtitle: `${e.type === "contractor" ? "Contractor" : "Employee"} — ${e.designation || "N/A"}`,
        totalAmount: data.totalPaid || 0,
        txnCount: data.txnCount || 0,
        monthlyData: data.monthlyPayments || [],
        categoryData: [],
        transactions: data.transactions || [],
      });
      setDrawerOpen(true);
    } catch (err) {
      console.error(err);
      toast("Failed to load employee details", "error");
    }
  }

  return (
    <div>
      <PageHeader title="Payroll" description="Employee management and salary processing">
        {view === "employees" && (
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}><Plus size={16} /> Add Employee</button>
        )}
      </PageHeader>

      <DateRangeFilter onChange={setDateRange} />

      {/* Suggestions from Bank Data */}
      {view === "employees" && visibleSuggestions.length > 0 && (
        <div style={{
          marginBottom: 24, padding: 20, background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))",
          borderRadius: 12, border: "1px solid rgba(99,102,241,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Sparkles size={18} color="#818CF8" />
            <h3 style={{ margin: 0, fontSize: 15 }}>Detected Payroll from Bank</h3>
            <span style={{ fontSize: 11, color: "var(--text-secondary)", background: "rgba(99,102,241,0.15)", padding: "2px 8px", borderRadius: 10 }}>
              {visibleSuggestions.length} found
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {visibleSuggestions.map(s => (
              <div key={s.name} style={{
                padding: 16, background: "var(--bg-card)", borderRadius: 10,
                border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {s.count}x in {s.distinctMonths} months
                    </div>
                  </div>
                  <span style={{
                    padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: s.isConsistent ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
                    color: s.isConsistent ? "#22C55E" : "#F59E0B",
                  }}>
                    {s.isConsistent ? "FIXED" : "VARIABLE"}
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(s.avgAmount)}<span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>/mo avg</span></div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => acceptPayrollSuggestion(s, "employee")}
                    style={{
                      flex: 1, padding: "6px 8px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 600,
                      background: "rgba(34,197,94,0.15)", color: "#22C55E", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                    }}
                  >
                    <UserCheck size={12} /> Employee
                  </button>
                  <button
                    onClick={() => acceptPayrollSuggestion(s, "contractor")}
                    style={{
                      flex: 1, padding: "6px 8px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 600,
                      background: "rgba(245,158,11,0.15)", color: "#F59E0B", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                    }}
                  >
                    <Briefcase size={12} /> Contractor
                  </button>
                  <button
                    onClick={() => dismissPayroll(s.name)}
                    style={{
                      padding: "6px 8px", borderRadius: 6, border: "none", fontSize: 11,
                      background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: "pointer",
                    }}
                  >
                    <EyeOff size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-secondary)", padding: 4, borderRadius: 8, width: "fit-content" }}>
        {(["employees", "payroll"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: "8px 20px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: view === v ? "var(--bg-card)" : "transparent",
            color: view === v ? "var(--text-primary)" : "var(--text-secondary)",
            boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
          }}>
            {v === "employees" ? "Employees" : "Payroll Runs"}
          </button>
        ))}
        {view === "payroll" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{
              background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
              borderRadius: 6, padding: "4px 8px", color: "var(--text-primary)", fontSize: 13,
            }} />
            <button className="btn btn-primary" onClick={runPayroll} disabled={processing || runs.length > 0} style={{ fontSize: 12, padding: "6px 14px" }}>
              <Play size={14} /> Run Payroll
            </button>
            {runs.some(r => r.status === "processed") && (
              <button className="btn btn-primary" onClick={payPayroll} disabled={processing} style={{ fontSize: 12, padding: "6px 14px", background: "#22C55E", borderColor: "#22C55E" }}>
                <Send size={14} /> Direct Deposit
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add Employee Form */}
      {showForm && (
        <div style={{ padding: 24, marginBottom: 24, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>New Employee</h3>
            <button aria-label="Close employee form" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }} onClick={() => setShowForm(false)}><X size={18} aria-hidden="true" /></button>
          </div>
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Name *</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Designation</label><input className="input" value={designation} onChange={(e) => setDesignation(e.target.value)} /></div>
            <div><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Department</label><input className="input" value={department} onChange={(e) => setDepartment(e.target.value)} /></div>
            <div><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Basic Salary *</label><input className="input" type="number" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} /></div>
            <div><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>HRA</label><input className="input" type="number" value={hra} onChange={(e) => setHra(e.target.value)} /></div>
            <div><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Annual CTC</label><input className="input" type="number" value={ctc} onChange={(e) => setCtc(e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={addEmployee} disabled={!name || !basicSalary}>Add Employee</button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Loading...</div>
      )}

      {/* Employee Table */}
      {!loading && view === "employees" && employees.length === 0 && (
        <EmptyState
          icon={Users}
          title="No employees"
          description="Add employees to start processing payroll"
          action={<button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Add Employee</button>}
        />
      )}

      {!loading && view === "employees" && employees.length > 0 && (
        <DataTable
          columns={[
            {
              header: "ID",
              accessorKey: "employeeId",
              cell: (row) => <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(99,102,241,0.1)", color: "#818CF8" }}>{row.employeeId}</span>,
            },
            {
              header: "Name",
              accessorKey: "name",
              cell: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
            },
            {
              header: "Type",
              accessorKey: "type",
              cell: (row) => (
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                  background: row.type === "contractor" ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)",
                  color: row.type === "contractor" ? "#F59E0B" : "#22C55E",
                }}>
                  {row.type === "contractor" ? "Contractor" : "Employee"}
                </span>
              ),
            },
            {
              header: "Designation",
              accessorKey: "designation",
              cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.designation || "\u2014"}</span>,
            },
            {
              header: "Dept",
              accessorKey: "department",
              cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.department || "\u2014"}</span>,
            },
            {
              header: "Basic",
              accessorKey: "basicSalary",
              align: "right",
              cell: (row) => <span>{fmt(row.basicSalary)}</span>,
            },
            {
              header: "HRA",
              accessorKey: "hra",
              align: "right",
              cell: (row) => <span>{fmt(row.hra)}</span>,
            },
            {
              header: "CTC (Annual)",
              accessorKey: "ctc",
              align: "right",
              cell: (row) => <span style={{ fontWeight: 700 }}>{fmt(row.ctc)}</span>,
            },
          ] as ColumnDef<Employee>[]}
          data={employees}
          searchPlaceholder="Search employees..."
          searchFilter={(item, query) => 
            item.name.toLowerCase().includes(query.toLowerCase()) || 
            item.employeeId.toLowerCase().includes(query.toLowerCase())
          }
          onRowClick={(row) => openEmployeeDetail(row)}
        />
      )}

      {/* Employee Analytics */}
      {view === "employees" && employees.length > 0 && (() => {
        const PIE_COLORS = ["#22C55E", "#F59E0B", "#818CF8", "#EF4444"];
        const typeData = [
          { name: "Employees", value: employees.filter(e => e.type !== "contractor").reduce((s, e) => s + e.ctc, 0) },
          { name: "Contractors", value: employees.filter(e => e.type === "contractor").reduce((s, e) => s + e.ctc, 0) },
        ].filter(d => d.value > 0);
        const topPayroll = [...employees].sort((a, b) => b.ctc - a.ctc).slice(0, 6)
          .map(e => ({ name: e.name.slice(0, 18), ctc: e.ctc }));

        return (
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 24 }}>
            <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <PieChartIcon size={16} /> Employee vs Contractor CTC
              </h3>
              <div style={{ height: 200 }}>
                <ChartAccessibilityWrapper label="Employee vs contractor CTC breakdown" data={typeData} dataKeys={["name", "value"]}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                      label={({ name, percent }: { name?: string; percent?: number }) => `${name || ""} ${((percent || 0) * 100).toFixed(0)}%`}>
                      {typeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => fmt(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                </ChartAccessibilityWrapper>
              </div>
            </div>
            <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <BarChart3 size={16} /> Top Payroll by CTC
              </h3>
              <div style={{ height: 200 }}>
                <ChartAccessibilityWrapper label="Top payroll costs by annual CTC" data={topPayroll} dataKeys={["name", "ctc"]}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topPayroll} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#E2E8F0", fontSize: 11 }} width={100} />
                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => fmt(Number(v))} />
                    <Bar dataKey="ctc" fill="#818CF8" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                </ChartAccessibilityWrapper>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Payroll Runs View */}
      {!loading && view === "payroll" && (
        <>
          {summary && (
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
              <div className="kpi-card"><div className="kpi-label">Gross Pay</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmt(summary.totalGross)}</div></div>
              <div className="kpi-card amber"><div className="kpi-label">Deductions</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmt(summary.totalDeductions)}</div></div>
              <div className="kpi-card green"><div className="kpi-label">Net Pay</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmt(summary.totalNet)}</div></div>
              <div className="kpi-card"><div className="kpi-label">Company Cost</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmt(summary.companyCost)}</div></div>
            </div>
          )}
          {runs.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title={`No payroll run for ${month}`}
              description="Click 'Run Payroll' to process salaries"
              action={<button className="btn btn-primary" onClick={runPayroll} disabled={processing}><Play size={16} /> Run Payroll</button>}
            />
          ) : (
            <DataTable
              columns={[
                {
                  header: "ID",
                  accessorKey: "employeeId",
                  cell: (row) => <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(99,102,241,0.1)", color: "#818CF8" }}>{row.employeeId}</span>,
                },
                {
                  header: "Name",
                  accessorKey: "name",
                  cell: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
                },
                {
                  header: "Gross",
                  accessorKey: "grossPay",
                  align: "right",
                  cell: (row) => <span>{fmt(row.grossPay)}</span>,
                },
                {
                  header: "PF",
                  accessorKey: "pfEmployee",
                  align: "right",
                  cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{fmt(row.pfEmployee)}</span>,
                },
                {
                  header: "ESI",
                  accessorKey: "esiEmployee",
                  align: "right",
                  cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{fmt(row.esiEmployee)}</span>,
                },
                {
                  header: "PT",
                  accessorKey: "professionalTax",
                  align: "right",
                  cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{fmt(row.professionalTax)}</span>,
                },
                {
                  header: "TDS",
                  accessorKey: "tds",
                  align: "right",
                  cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{fmt(row.tds)}</span>,
                },
                {
                  header: "Deductions",
                  accessorKey: "totalDeductions",
                  align: "right",
                  cell: (row) => <span style={{ color: "#EF4444", fontWeight: 600 }}>{fmt(row.totalDeductions)}</span>,
                },
                {
                  header: "Net Pay",
                  accessorKey: "netPay",
                  align: "right",
                  cell: (row) => (
                    <span style={{ fontWeight: 800, color: "#22C55E", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      {fmt(row.netPay)}
                      {row.status === "paid" && <Check size={14} color="#22C55E" />}
                    </span>
                  ),
                },
              ] as ColumnDef<PayrollEntry>[]}
              data={runs}
            />
          )}
        </>
      )}

      {/* Detail Drawer */}
      {drawerData && (
        <DetailDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={drawerData.title}
          subtitle={drawerData.subtitle}
          totalAmount={drawerData.totalAmount}
          totalLabel="Total Paid"
          txnCount={drawerData.txnCount}
          monthlyData={drawerData.monthlyData}
          categoryData={drawerData.categoryData}
          transactions={drawerData.transactions}
          detailUrl={`/payroll/${drawerData.entityId}`}
        />
      )}
    </div>
  );
}
