"use client";

import { clientLog } from "@/lib/client-logger";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DateRangeFilter } from "@/components/date-range-filter";
import {
  Repeat,
  Plus,
  X,
  Pause,
  Play,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Check,
  EyeOff,

  ChevronDown,
  ChevronRight,
  BarChart3,
  PieChart as PieChartIcon,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";

interface RecurringExpense {
  id: string;
  description: string;
  amount: number;
  frequency: string;
  nextDueDate: string;
  lastCreated: string | null;
  isActive: boolean;
  vendor: string | null;
  categoryId: string | null;
}

interface Category {
  id: string;
  name: string;
}

interface DetectedSuggestion {
  name: string;
  avgAmount: number;
  count: number;
  distinctMonths: number;
  variance: number;
  isConsistent: boolean;
  frequency: string;
  kind: string;
  confidence: number;
}

import { formatCurrency } from "@/lib/currency";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTable, ColumnDef } from "@/components/data-table";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";
const fmt = (n: number) => formatCurrency(n);

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export default function RecurringPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const router = useRouter();
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Form
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [vendor, setVendor] = useState("");
  const [categoryId, setCategoryId] = useState("");

  // Suggestions from bank data
  const [suggestions, setSuggestions] = useState<DetectedSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailTxns, setDetailTxns] = useState<{ date: string; amount: number; desc: string }[]>([]);
  const [dateRange, setDateRange] = useState({ from: "", to: "", label: "All Time" });

  async function load() {
    setLoading(true);
    try {
      const [recRes, catRes] = await Promise.all([
        fetch("/api/recurring-expenses").then((r) => r.json()),
        fetch("/api/categories").then((r) => r.json()).catch(() => ({ categories: [] })),
      ]);
      setItems(recRes.recurringExpenses || []);
      setCategories(catRes.categories || catRes || []);
    } catch (err) {
      clientLog.error("Failed to load recurring expenses", "recurring", "load", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [dateRange]);

  // Load dismissed from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("dismissed_recurring");
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, []);

  // Load suggestions
  useEffect(() => {
    fetch("/api/detect-recurring").then(r => r.json()).then(data => {
      setSuggestions(data.subscriptions || []);
    }).catch((err: unknown) => clientLog.error("Failed to detect recurring patterns", "recurring", "detect", err));
  }, [items]);

  async function create() {
    if (!desc || !amount) return;
    try {
      const res = await fetch("/api/recurring-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc,
          amount: Number(amount),
          frequency,
          vendor: vendor || undefined,
          categoryId: categoryId || undefined,
        }),
      });
      if (!res.ok) {
        toast("Failed to create", "error");
        return;
      }
      toast("Recurring expense created", "success");
      setShowForm(false);
      setDesc(""); setAmount(""); setFrequency("monthly"); setVendor(""); setCategoryId("");
      load();
    } catch (err) {
      clientLog.error("Failed to create recurring expense", "recurring", "create", err);
      toast("Failed to create", "error");
    }
  }

  async function deactivate(id: string) {
    try {
      await fetch(`/api/recurring-expenses?id=${id}`, { method: "DELETE" });
      toast("Recurring expense paused", "success");
      load();
    } catch (err) {
      clientLog.error("Failed to pause recurring expense", "recurring", "pause", err);
    }
  }

  async function resume(id: string) {
    try {
      await fetch("/api/recurring-expenses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: true }),
      });
      toast("Recurring expense resumed", "success");
      load();
    } catch (err) {
      clientLog.error("Failed to delete recurring expense", "recurring", "delete", err);
    }
  }

  async function toggleDetail(id: string, vendor: string | null) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    // Fetch matching bank transactions
    try {
      const res = await fetch("/api/expenses");
      const data = await res.json();
      const expenses = data.expenses || [];
      const vendorLower = (vendor || "").toLowerCase();
      const matched = expenses
        .filter((e: { description: string }) => e.description.toLowerCase().includes(vendorLower) && vendorLower.length >= 3)
        .map((e: { date: string; amount: number; description: string }) => ({
          date: new Date(e.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }),
          amount: Number(e.amount),
          desc: e.description.slice(0, 60),
        }))
        .slice(0, 20);
      setDetailTxns(matched);
    } catch { setDetailTxns([]); }
  }

  async function processDue() {
    setProcessing(true);
    try {
      const res = await fetch("/api/recurring-expenses", { method: "PATCH" });
      const data = await res.json();
      toast(`${data.processed} expenses created`, "success");
      load();
    } catch (err) {
      clientLog.error("Failed to accept suggestion", "recurring", "accept", err);
      toast("Failed to process", "error");
    } finally {
      setProcessing(false);
    }
  }

  async function acceptSuggestion(s: DetectedSuggestion) {
    try {
      const res = await fetch("/api/recurring-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: s.name,
          amount: s.avgAmount,
          frequency: s.frequency,
          vendor: s.name,
        }),
      });
      if (!res.ok) { toast("Failed to accept", "error"); return; }
      toast(`"${s.name}" added as recurring`, "success");
      load();
    } catch { toast("Failed", "error"); }
  }

  function dismissSuggestion(name: string) {
    const next = new Set(dismissed);
    next.add(name);
    setDismissed(next);
    try { localStorage.setItem("dismissed_recurring", JSON.stringify([...next])); } catch { /* ignore */ }
  }

  const visibleSuggestions = suggestions.filter(s => !dismissed.has(s.name));

  const active = items.filter((i) => i.isActive);
  const paused = items.filter((i) => !i.isActive);
  const monthlyTotal = active.reduce((sum, i) => {
    const multiplier = i.frequency === "weekly" ? 4.33 : i.frequency === "quarterly" ? 1 / 3 : i.frequency === "yearly" ? 1 / 12 : 1;
    return sum + i.amount * multiplier;
  }, 0);

  const dueCount = active.filter((i) => new Date(i.nextDueDate) <= new Date()).length;

  return (
    <>
    <div>
      <PageHeader title="Recurring Expenses" description="Subscriptions, rent, salaries — automated">
        {dueCount > 0 && (
          <button className="btn btn-secondary" onClick={processDue} disabled={processing}>
            <RefreshCw size={16} className={processing ? "spin" : ""} />
            Process {dueCount} Due
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Add Recurring
        </button>
        {paused.length > 0 && (
          <button className="btn btn-secondary" onClick={async () => {
            const ok = await confirm({ title: "Clear Paused Items?", message: `Delete all ${paused.length} paused recurring expenses? This cannot be undone.`, confirmLabel: "Delete All", destructive: true });
            if (!ok) return;
            for (const item of paused) {
              await fetch(`/api/recurring-expenses?id=${item.id}`, { method: "DELETE" });
            }
            toast(`Cleared ${paused.length} paused items`, "success");
            load();
          }} style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", borderColor: "rgba(239,68,68,0.3)" }}>
            <X size={16} /> Clear {paused.length} Paused
          </button>
        )}
      </PageHeader>

      <DateRangeFilter onChange={setDateRange} />

      {/* Suggestions from Bank Data */}
      {visibleSuggestions.length > 0 && (
        <div style={{
          marginBottom: 24, padding: 20, background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))",
          borderRadius: 12, border: "1px solid rgba(99,102,241,0.2)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={18} color="#818CF8" />
              <h3 style={{ margin: 0, fontSize: 15 }}>Detected from Bank Statements</h3>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", background: "rgba(99,102,241,0.15)", padding: "2px 8px", borderRadius: 10 }}>
                {visibleSuggestions.length} found
              </span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(s.avgAmount)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{FREQ_LABELS[s.frequency] || s.frequency}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => acceptSuggestion(s)}
                      style={{
                        padding: "6px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600,
                        background: "rgba(34,197,94,0.15)", color: "#22C55E", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4,
                      }}
                    >
                      <Check size={12} /> Accept
                    </button>
                    <button
                      onClick={() => dismissSuggestion(s.name)}
                      style={{
                        padding: "6px 8px", borderRadius: 6, border: "none", fontSize: 12,
                        background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: "pointer",
                      }}
                    >
                      <EyeOff size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <div style={{
          padding: 24, marginBottom: 24, background: "var(--bg-card)",
          borderRadius: 12, border: "1px solid var(--border-color)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>New Recurring Expense</h3>
            <button aria-label="Close recurring form" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }} onClick={() => setShowForm(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Description *</label>
              <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. AWS Hosting" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Amount (₹) *</label>
              <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="30000" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Frequency</label>
              <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Vendor</label>
              <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Amazon Web Services" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Category</label>
              <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Select category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={create} disabled={!desc || !amount}>Create</button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-label">Active Subscriptions</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{active.length}</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label">Monthly Commitment</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(monthlyTotal)}</div>
        </div>
        <div className="kpi-card" style={{ borderColor: dueCount > 0 ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.2)" }}>
          <div className="kpi-label">Due Now</div>
          <div className="kpi-value" style={{ fontSize: 28, color: dueCount > 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
            {dueCount}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Annual Cost</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(monthlyTotal * 12)}</div>
        </div>
      </div>

      {/* Active Items */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>Loading...</div>
      ) : active.length === 0 && paused.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No recurring expenses"
          description="Add subscriptions, rent, and other recurring costs to automate expense tracking"
          action={<button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Add Recurring</button>}
        />
      ) : (
        <>
          {active.length > 0 && (
            <div className="table-container" style={{ marginBottom: 24 }}>
              <div className="table-header">
                <h3><Play size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Active ({active.length})</h3>
              </div>
              <DataTable
                columns={[
                  {
                    header: "Description",
                    accessorKey: "description",
                    cell: (row) => (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                        {expandedId === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {row.description}
                      </span>
                    ),
                  },
                  {
                    header: "Vendor",
                    accessorKey: "vendor",
                    cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.vendor || "—"}</span>,
                  },
                  {
                    header: "Amount",
                    accessorKey: "amount",
                    align: "right",
                    cell: (row) => <span style={{ fontWeight: 600 }}>{fmt(row.amount)}</span>,
                  },
                  {
                    header: "Frequency",
                    accessorKey: "frequency",
                    cell: (row) => (
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: "rgba(99,102,241,0.15)", color: "#818CF8",
                      }}>
                        {FREQ_LABELS[row.frequency] || row.frequency}
                      </span>
                    ),
                  },
                  {
                    header: "Next Due",
                    accessorKey: "nextDueDate",
                    cell: (row) => (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                        <Calendar size={12} />
                        {new Date(row.nextDueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    ),
                  },
                  {
                    header: "Status",
                    accessorKey: "nextDueDate", // use a key, cell overrides it
                    cell: (row) => {
                      const isDue = new Date(row.nextDueDate) <= new Date();
                      return isDue ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#F43F5E", fontSize: 12, fontWeight: 600 }}>
                          <AlertTriangle size={12} /> Due
                        </span>
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#22C55E", fontSize: 12 }}>
                          <CheckCircle2 size={12} /> Scheduled
                        </span>
                      );
                    },
                  },
                  {
                    header: "",
                    accessorKey: "id",
                    sortable: false,
                    align: "right",
                    cell: (row) => (
                      <button
                        onClick={(e) => { e.stopPropagation(); deactivate(row.id); }}
                        style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 4 }}
                        title="Pause"
                      >
                        <Pause size={14} />
                      </button>
                    ),
                  },
                ] as ColumnDef<RecurringExpense>[]}
                data={active}
                onRowClick={(row) => toggleDetail(row.id, row.vendor)}
                renderExpandedRow={(row) => expandedId === row.id ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <div style={{
                        padding: 16, background: "rgba(99,102,241,0.04)", borderTop: "1px solid var(--border-color)",
                      }}>
                        <h4 style={{ margin: "0 0 12px", fontSize: 13 }}>Linked Bank Transactions ({detailTxns.length})</h4>
                        {detailTxns.length === 0 ? (
                          <p style={{ color: "var(--text-secondary)", fontSize: 12, margin: 0 }}>No matching bank transactions found for &quot;{row.vendor}&quot;</p>
                        ) : (
                          <>
                            {detailTxns.length >= 3 && (
                              <div style={{ height: 120, marginBottom: 12 }}>
                                <ChartAccessibilityWrapper label={`Transaction history for ${row.vendor || row.description}`} data={[...detailTxns].reverse()} dataKeys={["date", "amount"]}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={[...detailTxns].reverse()}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                    <XAxis dataKey="date" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                                    <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} width={60} />
                                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} />
                                    <Line type="monotone" dataKey="amount" stroke="#818CF8" strokeWidth={2} dot={{ fill: "#818CF8" }} />
                                  </LineChart>
                                </ResponsiveContainer>
                                </ChartAccessibilityWrapper>
                              </div>
                            )}
                            <div style={{ maxHeight: 150, overflowY: "auto" }}>
                              {detailTxns.map((t, i) => (
                                <div key={i} style={{
                                  display: "flex", justifyContent: "space-between", padding: "4px 0",
                                  borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12,
                                }}>
                                  <span style={{ color: "var(--text-secondary)" }}>{t.date}</span>
                                  <span style={{ flex: 1, margin: "0 12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.desc}</span>
                                  <span style={{ fontWeight: 600 }}>{fmt(t.amount)}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null}
              />
            </div>
          )}

          {paused.length > 0 && (
            <div className="table-container" style={{ opacity: 0.6 }}>
              <div className="table-header">
                <h3><Pause size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Paused ({paused.length})</h3>
              </div>
              <DataTable
                columns={[
                  {
                    header: "Description",
                    accessorKey: "description",
                  },
                  {
                    header: "Vendor",
                    accessorKey: "vendor",
                    cell: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.vendor || "—"}</span>,
                  },
                  {
                    header: "Amount",
                    accessorKey: "amount",
                    align: "right",
                    cell: (row) => <span style={{ fontWeight: 600 }}>{fmt(row.amount)}</span>,
                  },
                  {
                    header: "Frequency",
                    accessorKey: "frequency",
                    cell: (row) => (
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: "rgba(156,163,175,0.15)", color: "var(--text-secondary)",
                      }}>
                        {FREQ_LABELS[row.frequency] || row.frequency}
                      </span>
                    ),
                  },
                  {
                    header: "",
                    accessorKey: "id",
                    sortable: false,
                    align: "right",
                    cell: (row) => (
                      <button
                        onClick={(e) => { e.stopPropagation(); resume(row.id); }}
                        style={{ background: "none", border: "none", color: "#22C55E", cursor: "pointer", padding: 4 }}
                        title="Resume"
                      >
                        <Play size={14} />
                      </button>
                    ),
                  },
                ] as ColumnDef<RecurringExpense>[]}
                data={paused}
                onRowClick={(row) => router.push(`/recurring/${row.id}`)}
              />
            </div>
          )}
        </>
      )}

      {/* Analytics */}
      {active.length > 0 && (() => {
        const PIE_COLORS = ["#818CF8", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4"];
        const freqData = Object.entries(
          active.reduce<Record<string, number>>((acc, i) => {
            const label = FREQ_LABELS[i.frequency] || i.frequency;
            acc[label] = (acc[label] || 0) + i.amount;
            return acc;
          }, {})
        ).map(([name, value]) => ({ name, value: Math.round(value) }));

        const topVendors = [...active]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 6)
          .map(i => ({ name: (i.vendor || i.description).slice(0, 20), amount: Math.round(i.amount) }));

        return (
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 24 }}>
            <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <PieChartIcon size={16} /> Spending by Frequency
              </h3>
              <div style={{ height: 200 }}>
                <ChartAccessibilityWrapper label="Recurring spending breakdown by frequency" data={freqData} dataKeys={["name", "value"]}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={freqData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                      {freqData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => fmt(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                </ChartAccessibilityWrapper>
              </div>
            </div>
            <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <BarChart3 size={16} /> Top Recurring Costs
              </h3>
              <div style={{ height: 200 }}>
                <ChartAccessibilityWrapper label="Top recurring costs by vendor" data={topVendors} dataKeys={["name", "amount"]}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topVendors} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#E2E8F0", fontSize: 11 }} width={100} />
                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => fmt(Number(v))} />
                    <Bar dataKey="amount" fill="#818CF8" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                </ChartAccessibilityWrapper>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
    {confirmDialog}
    </>
  );
}
