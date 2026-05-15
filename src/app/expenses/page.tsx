"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, X, CreditCard, Filter, Trash2, Upload, Receipt, PieChart, Users, TrendingDown, TrendingUp, List, LayoutDashboard, Lightbulb, Sparkles, CheckSquare, Fingerprint } from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { SkeletonTable } from "@/components/skeleton";
import { DateRangeFilter } from "@/components/date-range-filter";
import { formatCurrency } from "@/lib/currency";
import { ExpenseDetailDrawer } from "@/components/item-detail-drawer";
import { PageHeader } from "@/components/page-header";
import { DataTable, ColumnDef } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StaggerContainer, SlideUp } from "@/components/animations";
import { TablePageSkeleton } from "@/components/page-skeleton";
import { AccessibleModal } from "@/components/accessible-modal";

interface Expense {
  id: string;
  description: string;
  amount: string;
  date: string;
  vendor?: string;
  receipt?: string;
  department?: string;
  category?: { name: string; color?: string };
}

type Tab = "overview" | "breakdown" | "vendors" | "trends" | "transactions";

export default function ExpensesPage() {
  return (
    <Suspense fallback={<TablePageSkeleton />}>
      <ExpensesContent />
    </Suspense>
  );
}

function ExpensesContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [suggestingCategory, setSuggestingCategory] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [uploadingReceipt, setUploadingReceipt] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Confidence stats
  interface ConfidenceStats {
    total: number; categorized: number; uncategorized: number;
    categorizationRate: number; avgConfidence: number;
    highConfidence: number; mediumConfidence: number; lowConfidence: number;
    reconciled: number; reconciliationRate: number;
  }
  const [confStats, setConfStats] = useState<ConfidenceStats | null>(null);

  // Vendor fingerprints
  interface VendorFingerprint {
    vendor: string; totalSpend: number; txnCount: number;
    dominantCategory: string; dominantCategoryColor: string;
    confidence: number; isConsistent: boolean;
    categories: { name: string; count: number; totalSpend: number; color: string }[];
  }
  interface FingerprintSummary { totalVendors: number; consistentVendors: number; inconsistentVendors: number; consistencyRate: number; }
  const [fingerprints, setFingerprints] = useState<VendorFingerprint[]>([]);
  const [fpSummary, setFpSummary] = useState<FingerprintSummary | null>(null);
  const [applyingFp, setApplyingFp] = useState<string | null>(null);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
    { id: "breakdown", label: "Category Breakdown", icon: <PieChart size={18} /> },
    { id: "vendors", label: "Top Vendors", icon: <Users size={18} /> },
    { id: "trends", label: "Monthly Trends", icon: <TrendingDown size={18} /> },
    { id: "transactions", label: "All Transactions", icon: <List size={18} /> },
  ];

  useEffect(() => { loadExpenses(); loadCategories(); loadConfidence(); loadFingerprints(); }, []);

  useEffect(() => {
    if (searchParams?.get("new") === "1") {
      setShowCreate(true);
      // Clean up URL so it doesn't re-trigger on refresh
      window.history.replaceState(null, "", "/expenses");
    }
  }, [searchParams]);

  const loadCategories = () => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {});
  };

  const loadConfidence = () => {
    fetch("/api/expenses/confidence")
      .then((res) => res.json())
      .then((d) => { if (d && !d.error) setConfStats(d); })
      .catch(() => {});
  };

  const loadFingerprints = () => {
    fetch("/api/vendors/fingerprints")
      .then((res) => res.json())
      .then((d) => {
        setFingerprints(d.fingerprints || []);
        setFpSummary(d.summary || null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!description || !amount || description.length < 3) return;
    const delayDebounceFn = setTimeout(async () => {
      setSuggestingCategory(true);
      try {
        const res = await fetch("/api/expenses/suggest-category", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description, vendor, amount: Number(amount) }),
        });
        const data = await res.json();
        if (data.category && categories.length > 0) {
          const matched = categories.find(c => c.name.toLowerCase() === data.category.toLowerCase());
          if (matched) setCategoryId(matched.id);
        }
      } catch (e) { clientLog.warn("Non-critical error", "expenses", "parse-meta", e); }
      setSuggestingCategory(false);
    }, 800);
    return () => clearTimeout(delayDebounceFn);
  }, [description, amount, vendor, categories]);

  const loadExpenses = () => {
    fetch("/api/expenses")
      .then((res) => res.json())
      .then((d) => { setExpenses(d.expenses || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const createExpense = async () => {
    if (!description || !amount) { toast("Description and amount are required", "error"); return; }
    await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, amount: Number(amount), date, vendor, notes, categoryId }),
    });
    setShowCreate(false);
    setDescription(""); setAmount(""); setVendor(""); setNotes(""); setCategoryId("");
    loadExpenses();
    toast("Expense logged successfully", "success");
  };

  const deleteExpense = async (id: string, desc: string) => {
    const ok = await confirm({ title: "Delete Expense", message: `Are you sure you want to delete "${desc}"?`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    loadExpenses();
    toast("Expense deleted", "info");
  };

  const uploadReceipt = async (expenseId: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,application/pdf";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploadingReceipt(expenseId);
      const formData = new FormData();
      formData.append("receipt", file);
      try {
        const res = await fetch(`/api/expenses/${expenseId}/receipt`, { method: "POST", body: formData });
        if (res.ok) { toast("Receipt uploaded", "success"); loadExpenses(); }
        else { const data = await res.json(); toast(data.error || "Upload failed", "error"); }
      } catch { toast("Failed to upload receipt", "error"); }
      setUploadingReceipt(null);
    };
    input.click();
  };


  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (filterCategory && e.category?.name !== filterCategory) return false;
      if (filterVendor && !(e.vendor || "").toLowerCase().includes(filterVendor.toLowerCase()) &&
          !e.description.toLowerCase().includes(filterVendor.toLowerCase())) return false;
      if (filterDateFrom && new Date(e.date) < new Date(filterDateFrom)) return false;
      if (filterDateTo && new Date(e.date) > new Date(filterDateTo + "T23:59:59")) return false;
      return true;
    });
  }, [expenses, filterCategory, filterVendor, filterDateFrom, filterDateTo]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    expenses.forEach((e) => { if (e.category?.name) cats.add(e.category.name); });
    return Array.from(cats).sort();
  }, [expenses]);

  const hasActiveFilters = filterCategory || filterVendor || filterDateFrom || filterDateTo;
  const clearFilters = () => { setFilterCategory(""); setFilterVendor(""); setFilterDateFrom(""); setFilterDateTo(""); };

  // Aggregated data
  const { catMap, vendorMap, monthlyMap } = useMemo(() => {
    const cm: Record<string, { total: number; count: number; color: string }> = {};
    const vm: Record<string, { total: number; count: number; category: string }> = {};
    const mm: Record<string, number> = {};
    for (const e of filteredExpenses) {
      const cat = e.category?.name || "Uncategorized";
      const col = e.category?.color || "#9CA3AF";
      if (!cm[cat]) cm[cat] = { total: 0, count: 0, color: col };
      cm[cat].total += Number(e.amount); cm[cat].count++;
      const v = e.vendor || "Unknown";
      if (!vm[v]) vm[v] = { total: 0, count: 0, category: cat };
      vm[v].total += Number(e.amount); vm[v].count++;
      const mKey = new Date(e.date).toISOString().slice(0, 7);
      mm[mKey] = (mm[mKey] || 0) + Number(e.amount);
    }
    return { catMap: cm, vendorMap: vm, monthlyMap: mm };
  }, [filteredExpenses]);

  const cats = Object.entries(catMap).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total);
  const topVendors = Object.entries(vendorMap).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total).slice(0, 15);
  const grand = cats.reduce((s, c) => s + c.total, 0);
  const sortedMonths = Object.entries(monthlyMap).sort(([a], [b]) => a.localeCompare(b)).slice(-12);

  const totalExpenses = grand;
  const thisMonth = filteredExpenses
    .filter((e) => { const d = new Date(e.date); const now = new Date(); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const avgMonthly = sortedMonths.length > 0 ? grand / sortedMonths.length : 0;
  const topCategory = cats.length > 0 ? cats[0] : null;

  const expenseColumns: ColumnDef<Expense>[] = [
    {
      header: (
        <input
          type="checkbox"
          checked={filteredExpenses.length > 0 && selectedIds.size === Math.min(filteredExpenses.length, 100)}
          onChange={(e) => {
            if (e.target.checked) setSelectedIds(new Set(filteredExpenses.slice(0, 100).map(x => x.id)));
            else setSelectedIds(new Set());
          }}
          style={{ cursor: "pointer", accentColor: "var(--accent-purple)" }}
        />
      ),
      sortable: false,
      cell: (exp) => (
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(exp.id)}
            onChange={(e) => {
              const next = new Set(selectedIds);
              if (e.target.checked) next.add(exp.id); else next.delete(exp.id);
              setSelectedIds(next);
            }}
            style={{ cursor: "pointer", accentColor: "var(--accent-purple)" }}
          />
        </div>
      )
    },
    { 
      header: "Description", 
      accessorKey: "description",
      cell: (e) => <span style={{ fontWeight: 600, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", verticalAlign: "middle" }}>{e.description}</span> 
    },
    { 
      header: "Vendor", 
      accessorKey: "vendor",
      cell: (e) => <span style={{ color: "var(--text-secondary)" }}>{e.vendor || "—"}</span> 
    },
    { 
      header: "Category", 
      sortable: false,
      cell: (e) => e.category ? <span className="badge" onClick={(ev) => { ev.stopPropagation(); setFilterCategory(e.category!.name); setShowFilters(true); }} style={{ background: `${e.category?.color || "var(--brand-primary)"}20`, color: e.category?.color || "var(--brand-primary)", cursor: "pointer" }}>{e.category.name}</span> : "—" 
    },
    { 
      header: "Date",
      accessorKey: "date",
      cell: (e) => <span style={{ color: "var(--text-secondary)" }}>{new Date(e.date).toLocaleDateString("en-IN")}</span> 
    },
    { 
      header: "Amount", 
      accessorKey: "amount",
      cell: (e) => <span style={{ fontWeight: 700, color: "var(--accent-red)" }}>{formatCurrency(Number(e.amount))}</span>, 
      align: "right" 
    },
    { 
      header: "Receipt", 
      sortable: false,
      cell: (e) => e.receipt ? <span style={{ color: "var(--accent-green)", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><Receipt size={14}/> ✓</span> : <button className="btn btn-ghost btn-sm" onClick={(ev) => { ev.stopPropagation(); uploadReceipt(e.id); }} disabled={uploadingReceipt === e.id}><Upload size={14}/></button> 
    },
    { 
      header: "", 
      sortable: false,
      align: "right",
      cell: (e) => <button className="btn btn-ghost btn-sm" onClick={(ev) => { ev.stopPropagation(); deleteExpense(e.id, e.description); }} style={{ color: "var(--accent-red)" }}><Trash2 size={14}/></button> 
    }
  ];

  const searchFilter = (item: Expense, q: string) => 
    item.description.toLowerCase().includes(q.toLowerCase()) || 
    (item.vendor || "").toLowerCase().includes(q.toLowerCase());

  // Conic gradient for donut
  const gradientParts: string[] = [];
  let offset = 0;
  for (const c of cats) {
    const pct = grand > 0 ? (c.total / grand) * 100 : 0;
    gradientParts.push(`${c.color} ${offset}% ${offset + pct}%`);
    offset += pct;
  }
  return (
    <>
    <div>
      {dialog}
      <PageHeader title="Expenses" description="Track, categorize, and analyze your business expenses">
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Log Expense
        </button>
      </PageHeader>

      <DateRangeFilter onChange={(r) => {
        if (r.from) setFilterDateFrom(r.from);
        else setFilterDateFrom("");
        if (r.to) setFilterDateTo(r.to);
        else setFilterDateTo("");
      }} />

      {/* Tab Navigation — Settings-style but bigger */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 24,
        background: "var(--bg-secondary)", padding: 6, borderRadius: 12,
        overflowX: "auto",
      }}>
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 20px", borderRadius: 10, border: "none",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s", whiteSpace: "nowrap",
              background: activeTab === tab.id ? "var(--bg-card)" : "transparent",
              color: activeTab === tab.id ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: activeTab === tab.id ? "0 2px 8px rgba(0,0,0,0.25)" : "none",
            }}>
            <span style={{ color: activeTab === tab.id ? "var(--accent-red)" : "var(--text-secondary)", display: "flex" }}>{tab.icon}</span>
            {tab.label}
            {tab.id === "transactions" && (
              <span style={{
                fontSize: 11, padding: "1px 7px", borderRadius: 8, fontWeight: 700,
                background: activeTab === tab.id ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
                color: activeTab === tab.id ? "var(--accent-red)" : "var(--text-secondary)",
              }}>{filteredExpenses.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* TAB: Overview */}
      {activeTab === "overview" && (
        <div>
          <StaggerContainer className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 20 }}>
            <SlideUp delay={0}>
            <div className="kpi-card red">
              <div className="kpi-label">{hasActiveFilters ? "Filtered Total" : "Total Expenses"}</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{formatCurrency(totalExpenses)}</div>
            </div>
            </SlideUp>
            <SlideUp delay={0.05}>
            <div className="kpi-card amber">
              <div className="kpi-label">This Month</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{formatCurrency(thisMonth)}</div>
            </div>
            </SlideUp>
            <SlideUp delay={0.1}>
            <div className="kpi-card purple">
              <div className="kpi-label">Avg Monthly Burn</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{formatCurrency(avgMonthly)}</div>
            </div>
            </SlideUp>
            <SlideUp delay={0.15}>
            <div className="kpi-card blue">
              <div className="kpi-label">Transactions</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{filteredExpenses.length}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                {cats.length} categories · {topVendors.length} vendors
              </div>
            </div>
            </SlideUp>
          </StaggerContainer>

          {/* AI Accuracy Card */}
          {confStats && confStats.total > 0 && (
            <div style={{
              padding: 20, borderRadius: 12, marginBottom: 16,
              background: "var(--bg-card)", border: "1px solid rgba(99, 102, 241, 0.2)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Sparkles size={16} style={{ color: "var(--accent-purple)" }} />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>AI Categorization Accuracy</h4>
              </div>
              <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Categorization Rate</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: confStats.categorizationRate >= 90 ? "#22C55E" : confStats.categorizationRate >= 70 ? "#F59E0B" : "#EF4444" }}>
                    {confStats.categorizationRate}%
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{confStats.categorized} of {confStats.total} txns</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Avg Confidence</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: confStats.avgConfidence >= 80 ? "#22C55E" : confStats.avgConfidence >= 60 ? "#F59E0B" : "#EF4444" }}>
                    {confStats.avgConfidence}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Reconciled</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#6366F1" }}>{confStats.reconciliationRate}%</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{confStats.reconciled} matched</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Needs Review</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: confStats.lowConfidence > 0 ? "#F59E0B" : "#22C55E" }}>
                    {confStats.lowConfidence + confStats.uncategorized}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>low confidence + uncategorized</div>
                </div>
              </div>
              {(confStats.highConfidence + confStats.mediumConfidence + confStats.lowConfidence) > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Confidence Distribution</div>
                  <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 20, background: "var(--bg-input)" }}>
                    {confStats.highConfidence > 0 && (
                      <div title={`High (90%+): ${confStats.highConfidence}`} style={{
                        width: `${(confStats.highConfidence / (confStats.highConfidence + confStats.mediumConfidence + confStats.lowConfidence)) * 100}%`,
                        background: "#22C55E", display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 700, color: "#fff", minWidth: 20,
                      }}>{confStats.highConfidence}</div>
                    )}
                    {confStats.mediumConfidence > 0 && (
                      <div title={`Medium (70-90%): ${confStats.mediumConfidence}`} style={{
                        width: `${(confStats.mediumConfidence / (confStats.highConfidence + confStats.mediumConfidence + confStats.lowConfidence)) * 100}%`,
                        background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 700, color: "#fff", minWidth: 20,
                      }}>{confStats.mediumConfidence}</div>
                    )}
                    {confStats.lowConfidence > 0 && (
                      <div title={`Low (<70%): ${confStats.lowConfidence}`} style={{
                        width: `${(confStats.lowConfidence / (confStats.highConfidence + confStats.mediumConfidence + confStats.lowConfidence)) * 100}%`,
                        background: "#6B7280", display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 700, color: "#fff", minWidth: 20,
                      }}>{confStats.lowConfidence}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: "#22C55E" }}>● High ≥90%</span>
                    <span style={{ fontSize: 10, color: "#F59E0B" }}>● Medium 70-90%</span>
                    <span style={{ fontSize: 10, color: "#6B7280" }}>● Low &lt;70%</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick insights */}
          {topCategory && (
            <div style={{
              padding: "14px 18px", borderRadius: 10, marginBottom: 16,
              background: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.12)",
              fontSize: 14, display: "flex", alignItems: "center", gap: 10,
            }}>
              <Lightbulb size={20} style={{ color: "#F59E0B" }} />
              <span>
                <strong>{topCategory.name}</strong> is your largest expense category at{" "}
                <strong>{formatCurrency(topCategory.total)}</strong> ({Math.round((topCategory.total / grand) * 100)}% of total) across {topCategory.count} transactions.
              </span>
            </div>
          )}

          {/* Mini donut + mini vendor preview */}
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="table-container" style={{ padding: 20, cursor: "pointer" }} onClick={() => setActiveTab("breakdown")}>
              <h4 style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span><PieChart size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Category Split</span>
                <span style={{ fontSize: 12, color: "var(--brand-primary)" }}>View Details →</span>
              </h4>
              {cats.length > 0 && (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{
                    width: 100, height: 100, borderRadius: "50%", flexShrink: 0,
                    background: `conic-gradient(${gradientParts.join(", ")})`,
                    position: "relative",
                  }}>
                    <div style={{
                      position: "absolute", inset: 22, borderRadius: "50%",
                      background: "var(--card-bg)",
                    }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    {cats.slice(0, 4).map((c) => (
                      <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{c.name}</span>
                        <span style={{ color: "var(--text-secondary)" }}>{Math.round((c.total / grand) * 100)}%</span>
                      </div>
                    ))}
                    {cats.length > 4 && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>+{cats.length - 4} more</div>}
                  </div>
                </div>
              )}
            </div>
            <div className="table-container" style={{ padding: 20, cursor: "pointer" }} onClick={() => setActiveTab("vendors")}>
              <h4 style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span><Users size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Top Payees</span>
                <span style={{ fontSize: 12, color: "var(--brand-primary)" }}>View Details →</span>
              </h4>
              {topVendors.slice(0, 5).map((v, i) => (
                <div key={v.name} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13,
                  borderBottom: i < 4 ? "1px solid var(--border)" : "none",
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                    background: "rgba(239,68,68,0.1)", color: "var(--accent-red)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>{i + 1}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                  <span style={{ fontWeight: 600, color: "var(--accent-red)", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{formatCurrency(v.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB: Category Breakdown */}
      {activeTab === "breakdown" && (
        <div className="table-container" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Expense Breakdown by Category</h3>
          {cats.length > 0 ? (
            <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 32, alignItems: "center" }}>
              <div style={{
                width: 200, height: 200, borderRadius: "50%", margin: "0 auto",
                background: `conic-gradient(${gradientParts.join(", ")})`,
                position: "relative",
              }}>
                <div style={{
                  position: "absolute", inset: 40, borderRadius: "50%",
                  background: "var(--card-bg)", display: "flex", alignItems: "center",
                  justifyContent: "center", flexDirection: "column",
                }}>
                  <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>Total</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{formatCurrency(grand)}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cats.map((c) => {
                  const pct = grand > 0 ? (c.total / grand) * 100 : 0;
                  return (
                    <div key={c.name} style={{ cursor: "pointer" }}
                      onClick={() => { setFilterCategory(c.name); setShowFilters(true); setActiveTab("transactions"); }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 12, height: 12, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
                          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>({c.count} txns)</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                          <span style={{ fontSize: 13, color: "var(--text-secondary)", minWidth: 40, textAlign: "right" }}>{Math.round(pct)}%</span>
                          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(c.total)}</span>
                        </div>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: c.color, transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={PieChart}
              title="No categorized expenses yet"
              description="Import bank statements to auto-categorize your expenses."
            />
          )}
        </div>
      )}

      {/* TAB: Top Vendors */}
      {activeTab === "vendors" && (
        <div className="table-container" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Top Vendors / Payees</h3>
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {topVendors.map((v, i) => {
              const pct = grand > 0 ? (v.total / grand) * 100 : 0;
              return (
                <div key={v.name} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                  borderRadius: 10, background: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--border)", cursor: "pointer",
                  transition: "all 0.15s",
                }} onClick={() => { setFilterVendor(v.name); setShowFilters(true); setActiveTab("transactions"); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.05)"; e.currentTarget.style.borderColor = "var(--brand-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "var(--border)"; }}>
                  <span style={{
                    width: 32, height: 32, borderRadius: "50%", fontSize: 13, fontWeight: 700, flexShrink: 0,
                    background: i < 3 ? "rgba(239,68,68,0.12)" : "rgba(99,102,241,0.1)",
                    color: i < 3 ? "var(--accent-red)" : "var(--brand-primary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{v.category} · {v.count} txns · {Math.round(pct)}% of total</div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-red)", fontVariantNumeric: "tabular-nums" }}>
                    {formatCurrency(v.total)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vendor Fingerprinting */}
          {fingerprints.length > 0 && fpSummary && (
            <div style={{
              marginTop: 20, padding: 20, borderRadius: 12,
              background: "var(--bg-card)", border: "1px solid rgba(139, 92, 246, 0.2)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Fingerprint size={16} style={{ color: "var(--accent-purple)" }} />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Vendor Intelligence</h4>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
                  {fpSummary.consistencyRate}% consistency · {fpSummary.inconsistentVendors} need review
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {fingerprints.filter((f) => f.txnCount >= 2).slice(0, 20).map((f) => (
                  <div
                    key={f.vendor}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderRadius: 8,
                      background: f.isConsistent ? "rgba(34,197,94,0.04)" : "rgba(245,158,11,0.04)",
                      border: `1px solid ${f.isConsistent ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)"}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.vendor}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {f.txnCount} txns · {formatCurrency(f.totalSpend)}
                      </div>
                    </div>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: `${f.dominantCategoryColor}20`,
                      color: f.dominantCategoryColor,
                    }}>
                      {f.dominantCategory}
                    </span>
                    <span style={{
                      padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                      background: f.confidence >= 90 ? "rgba(34,197,94,0.15)" : f.confidence >= 70 ? "rgba(245,158,11,0.15)" : "rgba(107,114,128,0.15)",
                      color: f.confidence >= 90 ? "#22C55E" : f.confidence >= 70 ? "#F59E0B" : "#6B7280",
                      minWidth: 36, textAlign: "center",
                    }}>
                      {f.confidence}%
                    </span>
                    {!f.isConsistent && f.categories.length > 1 && (
                      <select
                        className="form-input"
                        disabled={applyingFp === f.vendor}
                        onChange={async (e) => {
                          const catId = e.target.value;
                          if (!catId) return;
                          setApplyingFp(f.vendor);
                          await fetch("/api/vendors/fingerprints", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ vendor: f.vendor, categoryId: catId }),
                          });
                          setApplyingFp(null);
                          toast(`Re-categorized all "${f.vendor}" expenses`, "success");
                          loadExpenses();
                          loadFingerprints();
                        }}
                        style={{ width: 110, fontSize: 10, padding: "3px 6px" }}
                      >
                        <option value="">Fix →</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    {f.isConsistent && (
                      <span style={{ fontSize: 10, color: "#22C55E" }}>✓</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Monthly Trends */}
      {activeTab === "trends" && (() => {
        // Build monthly×category matrix
        const trendFilter = filterCategory; // reuse existing filter
        const monthlyCatMap: Record<string, Record<string, number>> = {};
        const allTrendMonths = new Set<string>();
        const allTrendCats = new Set<string>();
        for (const e of filteredExpenses) {
          if (trendFilter && e.category?.name !== trendFilter) continue;
          const mKey = new Date(e.date).toISOString().slice(0, 7);
          const cat = e.category?.name || "Uncategorized";
          allTrendMonths.add(mKey);
          allTrendCats.add(cat);
          if (!monthlyCatMap[mKey]) monthlyCatMap[mKey] = {};
          monthlyCatMap[mKey][cat] = (monthlyCatMap[mKey][cat] || 0) + Number(e.amount);
        }
        const tMonths = Array.from(allTrendMonths).sort().slice(-12);
        const tCats = Array.from(allTrendCats).sort();
        const catColors: Record<string, string> = {};
        for (const c of cats) catColors[c.name] = c.color;
        catColors["Uncategorized"] = "#9CA3AF";
        // Monthly totals for the bar chart
        const monthTotals = tMonths.map(m => {
          const obj = monthlyCatMap[m] || {};
          return Object.values(obj).reduce((s, v) => s + v, 0);
        });
        const maxBar = Math.max(...monthTotals, 1);

        return (
          <div className="table-container" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3>Monthly Spending Trends</h3>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <select className="form-input" value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  style={{ padding: "6px 12px", fontSize: 13, minWidth: 180 }}>
                  <option value="">All Categories</option>
                  {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {filterCategory && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setFilterCategory("")}
                    style={{ color: "var(--accent-red)", fontSize: 12 }}><X size={14} /> Clear</button>
                )}
              </div>
            </div>

            {tMonths.length > 0 ? (
              <div>
                {/* Stacked Bar Chart */}
                {(() => { const CHART_H = 260; return (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "0 4px", marginBottom: 8, minHeight: CHART_H + 40 }}>
                  {tMonths.map((m, mi) => {
                    const obj = monthlyCatMap[m] || {};
                    const total = monthTotals[mi];
                    const barPx = Math.max((total / maxBar) * CHART_H, 12);
                    const monthName = new Date(m + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
                    const segments = tCats.filter(c => (obj[c] || 0) > 0).map(c => ({
                      cat: c, val: obj[c] || 0, color: catColors[c] || "#6B7280",
                    })).sort((a, b) => b.val - a.val);

                    return (
                      <div key={m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 10, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                          {formatCurrency(total)}
                        </span>
                        <div style={{
                          width: "100%", maxWidth: 56, height: barPx,
                          borderRadius: "6px 6px 0 0", overflow: "hidden",
                          display: "flex", flexDirection: "column-reverse",
                        }}>
                          {segments.map((seg) => {
                            const segPct = total > 0 ? (seg.val / total) * 100 : 0;
                            return (
                              <div key={seg.cat} title={`${seg.cat}: ${formatCurrency(seg.val)}`}
                                style={{ width: "100%", height: `${segPct}%`, background: seg.color, minHeight: 3 }} />
                            );
                          })}
                        </div>
                        <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>{monthName}</span>
                      </div>
                    );
                  })}
                </div>
                ); })()}

                {/* Legend */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20, padding: "8px 0" }}>
                  {tCats.map(c => (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer", opacity: filterCategory && filterCategory !== c ? 0.4 : 1 }}
                      onClick={() => setFilterCategory(filterCategory === c ? "" : c)}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: catColors[c] || "#6B7280" }} />
                      <span>{c}</span>
                    </div>
                  ))}
                </div>

                {/* MoM insight */}
                {tMonths.length >= 2 && (() => {
                  const curr = monthTotals[monthTotals.length - 1];
                  const prev = monthTotals[monthTotals.length - 2];
                  const change = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
                  return (
                    <div style={{
                      marginBottom: 20, padding: "10px 16px", borderRadius: 10, fontSize: 13,
                      background: change > 0 ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.06)",
                      border: `1px solid ${change > 0 ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)"}`,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      {change > 0 ? <TrendingUp size={16} color="#22C55E" /> : <TrendingDown size={16} color="#EF4444" />}
                      {filterCategory || "Total spending"} {change > 0 ? "increased" : "decreased"} by <strong>{Math.abs(Math.round(change))}%</strong> this month vs last
                      ({formatCurrency(curr)} vs {formatCurrency(prev)})
                    </div>
                  );
                })()}

                {/* Monthly Dissection Table */}
                <h4 style={{ marginBottom: 12 }}>Monthly Category Dissection</h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th scope="col" style={{ position: "sticky", left: 0, background: "var(--card-bg)", zIndex: 1 }}>Category</th>
                        {tMonths.map(m => (
                          <th key={m} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {new Date(m + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}
                          </th>
                        ))}
                        <th scope="col" style={{ textAlign: "right", fontWeight: 700 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tCats.map(cat => {
                        const catTotal = tMonths.reduce((s, m) => s + (monthlyCatMap[m]?.[cat] || 0), 0);
                        return (
                          <tr key={cat} style={{ cursor: "pointer" }}
                            onClick={() => setFilterCategory(filterCategory === cat ? "" : cat)}>
                            <td style={{ position: "sticky", left: 0, background: "var(--card-bg)", zIndex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: catColors[cat] || "#6B7280", flexShrink: 0 }} />
                                <span style={{ fontWeight: 500 }}>{cat}</span>
                              </div>
                            </td>
                            {tMonths.map(m => {
                              const val = monthlyCatMap[m]?.[cat] || 0;
                              return (
                                <td key={m} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: val > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                                  {val > 0 ? formatCurrency(val) : "—"}
                                </td>
                              );
                            })}
                            <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--accent-red)" }}>
                              {formatCurrency(catTotal)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: "2px solid var(--border)" }}>
                        <td style={{ fontWeight: 700, position: "sticky", left: 0, background: "var(--card-bg)", zIndex: 1 }}>Total</td>
                        {tMonths.map((m, mi) => (
                          <td key={m} style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                            {formatCurrency(monthTotals[mi])}
                          </td>
                        ))}
                        <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--accent-red)" }}>
                          {formatCurrency(monthTotals.reduce((s, v) => s + v, 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={TrendingUp}
                title="Not enough data for trends"
                description="Record more expenses over time to unlock trend analysis."
              />
            )}
          </div>
        );
      })()}

      {/* TAB: All Transactions */}
      {activeTab === "transactions" && (
        <div className="table-container">
          <div className="table-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>All Expenses</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {hasActiveFilters && (
                <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ color: "var(--accent-red)", fontSize: 12 }}>
                  <X size={14} /> Clear
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setShowFilters(!showFilters)}
                style={hasActiveFilters ? { color: "var(--brand-primary)", background: "rgba(99, 102, 241, 0.1)" } : {}}>
                <Filter size={14} /> Filter{hasActiveFilters ? " ●" : ""}
              </button>
            </div>
          </div>
          {showFilters && (
            <div style={{
              padding: "14px 20px", background: "rgba(255,255,255,0.02)",
              borderBottom: "1px solid var(--border)", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center",
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Category</label>
                <select className="form-input" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                  style={{ minWidth: 160, padding: "6px 10px", fontSize: 13 }}>
                  <option value="">All Categories</option>
                  {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Vendor / Search</label>
                <input className="form-input" placeholder="Search vendor or description..." value={filterVendor}
                  onChange={(e) => setFilterVendor(e.target.value)} style={{ minWidth: 200, padding: "6px 10px", fontSize: 13 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>From</label>
                <input className="form-input" type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
                  style={{ padding: "6px 10px", fontSize: 13 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>To</label>
                <input className="form-input" type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
                  style={{ padding: "6px 10px", fontSize: 13 }} />
              </div>
            </div>
          )}
          {/* Active filter banner */}
          {hasActiveFilters && (
            <div style={{
              padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "rgba(99,102,241,0.08)", borderBottom: "1px solid rgba(99,102,241,0.15)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <Filter size={14} style={{ color: "var(--brand-primary)" }} />
                <span style={{ color: "var(--text-secondary)" }}>Filtered by:</span>
                {filterCategory && (
                  <span style={{
                    padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600,
                    background: "rgba(99,102,241,0.15)", color: "var(--brand-primary)",
                  }}>{filterCategory}</span>
                )}
                {filterVendor && (
                  <span style={{
                    padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600,
                    background: "rgba(99,102,241,0.15)", color: "var(--brand-primary)",
                  }}>&quot;{filterVendor}&quot;</span>
                )}
              </div>
              <button onClick={clearFilters} style={{
                padding: "5px 14px", borderRadius: 8, border: "1px solid var(--brand-primary)",
                background: "transparent", color: "var(--brand-primary)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--brand-primary)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--brand-primary)"; }}
              >Show All</button>
            </div>
          )}
          {/* Bulk Actions Toolbar */}
          {selectedIds.size > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", marginBottom: 8,
              background: "rgba(99, 102, 241, 0.1)", borderRadius: 10,
              border: "1px solid rgba(99, 102, 241, 0.25)",
            }}>
              <CheckSquare size={16} style={{ color: "var(--accent-purple)" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-purple)" }}>
                {selectedIds.size} selected
              </span>
              <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
                <select
                  className="form-input"
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  style={{ fontSize: 12, padding: "6px 10px", width: 160, background: "var(--bg-card)" }}
                >
                  <option value="">Re-categorize...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!bulkCategory || bulkProcessing}
                  onClick={async () => {
                    if (!bulkCategory) return;
                    setBulkProcessing(true);
                    const promises = Array.from(selectedIds).map((id) =>
                      fetch(`/api/expenses/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ categoryId: bulkCategory }),
                      })
                    );
                    await Promise.all(promises);
                    setBulkProcessing(false);
                    setSelectedIds(new Set());
                    setBulkCategory("");
                    loadExpenses();
                    toast(`Re-categorized ${promises.length} expenses`, "success");
                  }}
                  style={{ fontSize: 12, padding: "6px 12px" }}
                >
                  {bulkProcessing ? "Applying..." : "Apply"}
                </button>
                <div style={{ width: 1, height: 20, background: "var(--border-color)" }} />
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: "var(--accent-red)", fontSize: 12 }}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Bulk Delete",
                      message: `Delete ${selectedIds.size} expenses? This cannot be undone.`,
                      confirmLabel: "Delete All",
                      destructive: true,
                    });
                    if (!ok) return;
                    setBulkProcessing(true);
                    await Promise.all(Array.from(selectedIds).map((id) =>
                      fetch(`/api/expenses/${id}`, { method: "DELETE" })
                    ));
                    setBulkProcessing(false);
                    setSelectedIds(new Set());
                    loadExpenses();
                    toast(`Deleted ${selectedIds.size} expenses`, "info");
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedIds(new Set())}
                  style={{ fontSize: 12 }}
                >
                  <X size={14} /> Clear
                </button>
              </div>
            </div>
          )}
          {loading ? (
            <SkeletonTable rows={5} />
          ) : (
            <DataTable 
              data={filteredExpenses.slice(0, 100)} 
              columns={expenseColumns} 
              onRowClick={(exp) => setSelectedExpense(exp)}
              searchPlaceholder="Search vendor or description (local view)..."
              searchFilter={searchFilter}
              emptyState={
                <EmptyState 
                  icon={Receipt} 
                  title={hasActiveFilters ? "No expenses match your filters" : "No expenses recorded"} 
                  description={hasActiveFilters ? "Try adjusting your filter criteria" : "Import bank statements or log expenses manually"} 
                  action={
                    hasActiveFilters ? <button className="btn btn-primary" onClick={clearFilters}><X size={14} /> Clear Filters</button> : undefined
                  }
                />
              }
            />
          )}
          {filteredExpenses.length > 100 && (
            <div style={{ textAlign: "center", padding: 12, fontSize: 12, color: "var(--text-secondary)" }}>
              Showing 100 of {filteredExpenses.length} transactions.
            </div>
          )}
        </div>
      )}

      {/* Create Expense Modal */}
      {showCreate && (
        <AccessibleModal open={showCreate} onClose={() => setShowCreate(false)} titleId="create-expense-title">
            <div className="modal-header">
              <h3 id="create-expense-title">Log Expense</h3>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)} aria-label="Close expense form"><X size={20} aria-hidden="true" /></button>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" placeholder="e.g., Office supplies" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Amount (₹)</label>
                <input className="form-input" type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Vendor</label>
                <input className="form-input" placeholder="e.g., Amazon" value={vendor} onChange={(e) => setVendor(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Category {suggestingCategory && <span style={{ fontSize: 10, color: "var(--accent-purple)", marginLeft: 6 }}><Sparkles size={10} style={{ display: "inline", verticalAlign: "middle" }} /> AI Suggesting...</span>}
                </label>
                <select className="form-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-input" placeholder="Additional details..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createExpense}><CreditCard size={16} /> Log Expense</button>
            </div>
        </AccessibleModal>
      )}
    </div>
    <ExpenseDetailDrawer
      open={!!selectedExpense}
      onClose={() => setSelectedExpense(null)}
      item={selectedExpense ? { ...selectedExpense, amount: Number(selectedExpense.amount) } : null}
    />
    </>
  );
}
