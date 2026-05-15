"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, X, TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownRight, BarChart3, Filter, PieChart, Users, List, LayoutDashboard, Lightbulb, RefreshCw, Link2, Unlink } from "lucide-react";
import { useToast } from "@/components/toast";
import { SkeletonTable } from "@/components/skeleton";
import { DateRangeFilter } from "@/components/date-range-filter";
import { formatCurrency } from "@/lib/currency";
import { RevenueDetailDrawer } from "@/components/item-detail-drawer";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { DataTable, ColumnDef } from "@/components/data-table";
import { AccessibleModal } from "@/components/accessible-modal";

interface Revenue {
  id: string;
  month: string;
  amount: string;
  type: string;
  category?: string;
  source?: string;
  client?: { id: string; name: string };
  clientId?: string | null;
}

const REVENUE_CATEGORIES = [
  "Income / Revenue", "SaaS Subscription", "Consulting", "Licensing", "Interest",
  "Commission", "Service Revenue", "Product Sales", "Infrastructure", "Software",
  "Salaries", "Travel", "Misc", "Other",
];

/** Extract clean client/company name from raw bank transaction descriptions.
 *  e.g. 'GRS/0357GRSB2603 0131 9373521 80131 Solar Punk Ltd~...' → 'Solar Punk Ltd'
 *  e.g. 'GRS/0357GRSK2505 9106 P202511130000257 PARITY TECHNOLOGIES LIMITED~...' → 'PARITY TECHNOLOGIES LIMITED' */
function extractClientName(raw: string): string {
  if (!raw) return "Unknown";
  // If it doesn't look like a bank ref, return as-is
  if (!/^(GRS|NEFT|RTGS|IMPS|UPI|IFT)\//i.test(raw) && raw.length < 50) return raw;

  // Strip everything after '~' (duplicate ref)
  let cleaned = raw.includes('~') ? raw.split('~')[0] : raw;
  
  // Remove the GRS/xxxx prefix (e.g. 'GRS/0357GRSB2603')
  cleaned = cleaned.replace(/^(GRS|NEFT|RTGS|IMPS|UPI|IFT)\/\S+\s*/i, '');
  
  // Remove payment reference numbers (P followed by 12+ digits)
  cleaned = cleaned.replace(/\bP\d{10,}\b/g, '').trim();
  
  // Split into tokens and find the first token that starts with a letter
  const tokens = cleaned.split(/\s+/);
  let nameStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (/^[A-Za-z]/.test(tokens[i])) {
      nameStart = i;
      break;
    }
  }
  
  if (nameStart >= 0) {
    let name = tokens.slice(nameStart).join(' ').trim();
    // Remove 'Unit A30 Red S' style suffixes (partial address fragments)
    name = name.replace(/\s+Unit\s+\w+.*$/i, '').trim();
    // Remove trailing stray digits
    name = name.replace(/\s+\d{4,}.*$/, '').trim();
    if (name.length > 2) return name;
  }
  
  // Fallback: look for known company name patterns anywhere in original
  const suffixMatch = raw.match(/([A-Z][A-Za-z\s]+(?:Ltd|Limited|LLP|Corp|Inc|Pvt|Technologies|Services|Solutions|Payment|Consulting))/i);
  if (suffixMatch) return suffixMatch[1].trim();

  // Final fallback: truncate
  return raw.length > 40 ? raw.slice(0, 40) + '…' : raw;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Income / Revenue": "#22C55E",
  "SaaS Subscription": "#6366F1",
  "Consulting": "#A855F7",
  "Licensing": "#3B82F6",
  "Interest": "#14B8A6",
  "Commission": "#F59E0B",
  "Service Revenue": "#EC4899",
  "Product Sales": "#0EA5E9",
  "Infrastructure": "#F97316",
  "Software": "#8B5CF6",
  "Salaries": "#EF4444",
  "Travel": "#E11D48",
  "Misc": "#9CA3AF",
  "Other": "#6B7280",
};

interface MrrData {
  mrr: number;
  arr: number;
}

type Tab = "overview" | "breakdown" | "sources" | "trends" | "records";

export default function RevenuePage() {
  const { toast } = useToast();
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("recurring");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [mrrData, setMrrData] = useState<MrrData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [dateRange, setDateRange] = useState({ from: "", to: "", label: "All Time" });
  const [selectedRevenue, setSelectedRevenue] = useState<Revenue | null>(null);

  const tabsList: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
    { id: "breakdown", label: "Revenue Breakdown", icon: <PieChart size={18} /> },
    { id: "sources", label: "Top Sources", icon: <Users size={18} /> },
    { id: "trends", label: "Monthly Trends", icon: <TrendingUp size={18} /> },
    { id: "records", label: "All Records", icon: <List size={18} /> },
  ];

  useEffect(() => { loadRevenue(); loadMrrData(); }, [dateRange]);

  const loadRevenue = () => {
    const params = new URLSearchParams();
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    const qs = params.toString();
    fetch(`/api/revenue${qs ? `?${qs}` : ""}`)
      .then((res) => res.json())
      .then((d) => { setRevenues(d.revenues || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const loadMrrData = () => {
    fetch("/api/v1/copilot/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "getRunway" }),
    })
      .then((res) => res.json())
      .then((d) => { if (d && !d.error) setMrrData(d.data || d); })
      .catch(() => {});
  };

  const createRevenue = async () => {
    if (!month || !amount) return;
    await fetch("/api/revenue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: `${month}-01`, amount: Number(amount), type, category: category || undefined, source }),
    });
    setShowCreate(false);
    setAmount(""); setCategory(""); setSource("");
    loadRevenue(); loadMrrData();
    toast("Revenue recorded", "success");
  };


  const filteredRevenues = useMemo(() => {
    return revenues.filter((r) => {
      if (filterCategory && r.category !== filterCategory) return false;
      if (filterSource && !(r.source || "").toLowerCase().includes(filterSource.toLowerCase())) return false;
      return true;
    });
  }, [revenues, filterCategory, filterSource]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    revenues.forEach((r) => { if (r.category) cats.add(r.category); });
    return Array.from(cats).sort();
  }, [revenues]);

  const hasActiveFilters = filterCategory || filterSource;
  const clearFilters = () => { setFilterCategory(""); setFilterSource(""); };

  const { catMap, sourceMap, monthlyMap } = useMemo(() => {
    const cm: Record<string, { total: number; count: number; color: string }> = {};
    const sm: Record<string, { total: number; count: number; category: string; type: string; clientName: string | null; clientId: string | null; distinctMonths: Set<string>; rawSource: string }> = {};
    const mm: Record<string, number> = {};
    for (const r of filteredRevenues) {
      const cat = r.category || "Uncategorized";
      const col = CATEGORY_COLORS[cat] || "#6B7280";
      if (!cm[cat]) cm[cat] = { total: 0, count: 0, color: col };
      cm[cat].total += Number(r.amount); cm[cat].count++;
      const src = extractClientName(r.source || "");
      if (!sm[src]) sm[src] = { total: 0, count: 0, category: cat, type: r.type || "one-time", clientName: r.client?.name || null, clientId: r.clientId || null, distinctMonths: new Set(), rawSource: r.source || "" };
      sm[src].total += Number(r.amount); sm[src].count++;
      sm[src].distinctMonths.add(new Date(r.month).toISOString().slice(0, 7));
      // Prefer "recurring" over "one-time" if any entry is recurring
      if (r.type === "recurring") sm[src].type = "recurring";
      if (r.client?.name) { sm[src].clientName = r.client.name; sm[src].clientId = r.clientId || null; }
      const mKey = new Date(r.month).toISOString().slice(0, 7);
      mm[mKey] = (mm[mKey] || 0) + Number(r.amount);
    }
    return { catMap: cm, sourceMap: sm, monthlyMap: mm };
  }, [filteredRevenues]);

  // Merge near-duplicate sources (e.g. 'Solar Punk L' + 'Solar Punk Ltd')
  const mergedSourceMap = useMemo(() => {
    const keys = Object.keys(sourceMap).sort((a, b) => sourceMap[b].count - sourceMap[a].count);
    const merged: Record<string, { total: number; count: number; category: string; type: string; clientName: string | null; clientId: string | null; distinctMonths: number; rawSource: string }> = {};
    for (const k of keys) {
      let found = false;
      for (const existing of Object.keys(merged)) {
        const el = existing.toLowerCase(), kl = k.toLowerCase();
        if (el.startsWith(kl) || kl.startsWith(el)) {
          merged[existing].total += sourceMap[k].total;
          merged[existing].count += sourceMap[k].count;
          // Merge distinct months
          merged[existing].distinctMonths = Math.max(merged[existing].distinctMonths, sourceMap[k].distinctMonths.size);
          if (sourceMap[k].type === "recurring") merged[existing].type = "recurring";
          if (sourceMap[k].clientName) { merged[existing].clientName = sourceMap[k].clientName; merged[existing].clientId = sourceMap[k].clientId; }
          found = true;
          break;
        }
      }
      if (!found) {
        merged[k] = { ...sourceMap[k], distinctMonths: sourceMap[k].distinctMonths.size };
      }
    }
    return merged;
  }, [sourceMap]);

  const cats = Object.entries(catMap).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total);
  const topSources = Object.entries(mergedSourceMap).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total).slice(0, 15);
  const grand = cats.reduce((s, c) => s + c.total, 0);


  const totalRevenue = grand;
  const recurringRevenue = filteredRevenues.filter(r => r.type === "recurring").reduce((s, r) => s + Number(r.amount), 0);
  const oneTimeRevenue = filteredRevenues.filter(r => r.type === "one-time").reduce((s, r) => s + Number(r.amount), 0);
  const currentMRR = mrrData?.mrr ?? recurringRevenue;
  const currentARR = mrrData?.arr ?? recurringRevenue * 12;
  const topCategory = cats.length > 0 ? cats[0] : null;

  const recurringByMonth = revenues.filter(r => r.type === "recurring").reduce((acc, r) => {
    const key = new Date(r.month).toISOString().slice(0, 7);
    acc[key] = (acc[key] || 0) + Number(r.amount);
    return acc;
  }, {} as Record<string, number>);
  const sortedMrrMonths = Object.entries(recurringByMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const mrrGrowth = sortedMrrMonths.length >= 2
    ? ((sortedMrrMonths[sortedMrrMonths.length - 1][1] - sortedMrrMonths[sortedMrrMonths.length - 2][1]) / sortedMrrMonths[sortedMrrMonths.length - 2][1]) * 100
    : 0;

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
      <PageHeader title="Revenue" description="Track your MRR, ARR, and revenue growth">
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Record Revenue
        </button>
      </PageHeader>

      <DateRangeFilter onChange={setDateRange} />

      {/* Tab Navigation */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 24,
        background: "var(--bg-secondary)", padding: 6, borderRadius: 12,
        overflowX: "auto",
      }}>
        {tabsList.map((tab) => (
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
            <span style={{ color: activeTab === tab.id ? "var(--accent-green)" : "var(--text-secondary)", display: "flex" }}>{tab.icon}</span>
            {tab.label}
            {tab.id === "records" && (
              <span style={{
                fontSize: 11, padding: "1px 7px", borderRadius: 8, fontWeight: 700,
                background: activeTab === tab.id ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.06)",
                color: activeTab === tab.id ? "var(--accent-green)" : "var(--text-secondary)",
              }}>{filteredRevenues.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* TAB: Overview */}
      {activeTab === "overview" && (
        <div>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 20 }}>
            <div className="kpi-card green">
              <div className="kpi-icon green"><DollarSign size={20} /></div>
              <div className="kpi-label">{hasActiveFilters ? "Filtered Revenue" : "Total Revenue"}</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{formatCurrency(totalRevenue)}</div>
            </div>
            <div className="kpi-card purple">
              <div className="kpi-icon purple"><TrendingUp size={20} /></div>
              <div className="kpi-label">Current MRR</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{formatCurrency(currentMRR)}</div>
              {mrrGrowth !== 0 && (
                <span className={`kpi-change ${mrrGrowth > 0 ? "up" : "down"}`}>
                  {mrrGrowth > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {Math.abs(Math.round(mrrGrowth))}%
                </span>
              )}
            </div>
            <div className="kpi-card blue">
              <div className="kpi-icon blue"><BarChart3 size={20} /></div>
              <div className="kpi-label">Current ARR</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{formatCurrency(currentARR)}</div>
            </div>
            <div className="kpi-card amber">
              <div className="kpi-label">One-Time Revenue</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>{formatCurrency(oneTimeRevenue)}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                {filteredRevenues.length} records · {cats.length} categories
              </div>
            </div>
          </div>

          {topCategory && (
            <div style={{
              padding: "14px 18px", borderRadius: 10, marginBottom: 16, fontSize: 14,
              background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <Lightbulb size={20} style={{ color: "#F59E0B" }} />
              <span>
                <strong>{topCategory.name}</strong> is your primary revenue source at{" "}
                <strong>{formatCurrency(topCategory.total)}</strong> ({Math.round((topCategory.total / grand) * 100)}% of total) across {topCategory.count} entries.
              </span>
            </div>
          )}

          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="table-container" style={{ padding: 20, cursor: "pointer" }} onClick={() => setActiveTab("breakdown")}>
              <h4 style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span><PieChart size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Revenue Split</span>
                <span style={{ fontSize: 12, color: "var(--accent-green)" }}>View Details →</span>
              </h4>
              {cats.length > 0 && (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{
                    width: 100, height: 100, borderRadius: "50%", flexShrink: 0,
                    background: `conic-gradient(${gradientParts.join(", ")})`,
                    position: "relative",
                  }}>
                    <div style={{ position: "absolute", inset: 22, borderRadius: "50%", background: "var(--card-bg)" }} />
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
            <div className="table-container" style={{ padding: 20, cursor: "pointer" }} onClick={() => setActiveTab("sources")}>
              <h4 style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span><Users size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Top Sources</span>
                <span style={{ fontSize: 12, color: "var(--accent-green)" }}>View Details →</span>
              </h4>
              {topSources.slice(0, 5).map((s, i) => (
                <div key={s.name} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13,
                  borderBottom: i < 4 ? "1px solid var(--border)" : "none",
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                    background: "rgba(34,197,94,0.1)", color: "var(--accent-green)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>{i + 1}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ fontWeight: 600, color: "var(--accent-green)", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{formatCurrency(s.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB: Revenue Breakdown */}
      {activeTab === "breakdown" && (
        <div className="table-container" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Revenue Breakdown by Category</h3>
          {cats.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 32, alignItems: "center" }}>
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
                      onClick={() => { setFilterCategory(c.name); setShowFilters(true); setActiveTab("records"); }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 12, height: 12, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
                          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>({c.count} entries)</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                          <span style={{ fontSize: 13, color: "var(--text-secondary)", minWidth: 40, textAlign: "right" }}>{Math.round(pct)}%</span>
                          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 110, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--accent-green)" }}>{formatCurrency(c.total)}</span>
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
              title="No categorized revenue yet"
              description="Assign categories to revenue records to see the breakdown."
            />
          )}
        </div>
      )}

      {/* TAB: Top Sources */}
      {activeTab === "sources" && (
        <div className="table-container" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Top Revenue Sources</h3>
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {topSources.map((s, i) => {
              const pct = grand > 0 ? (s.total / grand) * 100 : 0;
              const isRecurring = s.type === "recurring";
              return (
                <div key={s.name} style={{
                  display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px",
                  borderRadius: 10, background: "rgba(255,255,255,0.02)",
                  border: `1px solid ${isRecurring ? "rgba(34,197,94,0.2)" : "var(--border)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{
                      width: 32, height: 32, borderRadius: "50%", fontSize: 13, fontWeight: 700, flexShrink: 0,
                      background: i < 3 ? "rgba(34,197,94,0.12)" : "rgba(99,102,241,0.1)",
                      color: i < 3 ? "var(--accent-green)" : "var(--brand-primary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                        {/* Recurring / One-time badge */}
                        <span style={{
                          padding: "1px 8px", borderRadius: 12, fontSize: 10, fontWeight: 700,
                          background: isRecurring ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                          color: isRecurring ? "#22C55E" : "#F59E0B",
                          display: "flex", alignItems: "center", gap: 4,
                        }}>
                          {isRecurring ? <><RefreshCw size={9} /> Recurring</> : "One-time"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {s.category} · {s.count} txns · {Math.round(pct)}% of total · {s.distinctMonths} month{s.distinctMonths !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-green)", fontVariantNumeric: "tabular-nums" }}>
                      {formatCurrency(s.total)}
                    </div>
                  </div>
                  {/* Action row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {/* Toggle recurring / one-time */}
                    <button
                      style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        border: `1px solid ${isRecurring ? "rgba(245,158,11,0.3)" : "rgba(34,197,94,0.3)"}`,
                        background: "transparent",
                        color: isRecurring ? "#F59E0B" : "#22C55E",
                        cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                      }}
                      onClick={async () => {
                        const newType = isRecurring ? "one-time" : "recurring";
                        await fetch("/api/revenue", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ source: s.rawSource, type: newType }),
                        });
                        toast(`Marked as ${newType}`, "success");
                        loadRevenue();
                      }}
                    >
                      {isRecurring ? <>Mark as Ended</> : <><RefreshCw size={10} /> Mark as Recurring</>}
                    </button>
                    {/* Client link */}
                    {s.clientName ? (
                      <span style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: "rgba(99,102,241,0.08)", color: "#A5B4FC",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                        <Link2 size={10} /> {s.clientName}
                        <button
                          onClick={async () => {
                            await fetch("/api/revenue", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ source: s.rawSource, clientId: null }),
                            });
                            toast("Client unlinked", "success");
                            loadRevenue();
                          }}
                          style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 0, marginLeft: 4, display: "flex" }}
                          title="Unlink client"
                        >
                          <Unlink size={10} />
                        </button>
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>No client linked</span>
                    )}
                    {/* View records */}
                    <button
                      style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        border: "1px solid var(--border)", background: "transparent",
                        color: "var(--text-secondary)", cursor: "pointer", marginLeft: "auto",
                      }}
                      onClick={() => { setFilterSource(s.name); setShowFilters(true); setActiveTab("records"); }}
                    >
                      View Records →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB: Monthly Trends */}
      {activeTab === "trends" && (() => {
        const trendFilter = filterCategory;
        const monthlyCatMap: Record<string, Record<string, number>> = {};
        const allTrendMonths = new Set<string>();
        const allTrendCats = new Set<string>();
        for (const r of filteredRevenues) {
          if (trendFilter && r.category !== trendFilter) continue;
          const mKey = new Date(r.month).toISOString().slice(0, 7);
          const cat = r.category || "Uncategorized";
          allTrendMonths.add(mKey);
          allTrendCats.add(cat);
          if (!monthlyCatMap[mKey]) monthlyCatMap[mKey] = {};
          monthlyCatMap[mKey][cat] = (monthlyCatMap[mKey][cat] || 0) + Number(r.amount);
        }
        const tMonths = Array.from(allTrendMonths).sort().slice(-12);
        const tCats = Array.from(allTrendCats).sort();
        const monthTotals = tMonths.map(m => {
          const obj = monthlyCatMap[m] || {};
          return Object.values(obj).reduce((s, v) => s + v, 0);
        });
        const maxBar = Math.max(...monthTotals, 1);

        return (
          <div className="table-container" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3>Monthly Revenue Trend</h3>
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
                      cat: c, val: obj[c] || 0, color: CATEGORY_COLORS[c] || "#6B7280",
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
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: CATEGORY_COLORS[c] || "#6B7280" }} />
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
                      background: change > 0 ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
                      border: `1px solid ${change > 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)"}`,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      {change > 0 ? <TrendingUp size={16} color="#22C55E" /> : <TrendingDown size={16} color="#EF4444" />}
                      {filterCategory || "Total revenue"} {change > 0 ? "grew" : "declined"} by <strong>{Math.abs(Math.round(change))}%</strong> this month vs last
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
                        <th style={{ position: "sticky", left: 0, background: "var(--card-bg)", zIndex: 1 }}>Category</th>
                        {tMonths.map(m => (
                          <th key={m} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {new Date(m + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}
                          </th>
                        ))}
                        <th style={{ textAlign: "right", fontWeight: 700 }}>Total</th>
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
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[cat] || "#6B7280", flexShrink: 0 }} />
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
                            <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--accent-green)" }}>
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
                        <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--accent-green)" }}>
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
                description="Record more revenue over time to unlock trend analysis."
              />
            )}
          </div>
        );
      })()}

      {/* TAB: All Records */}
      {activeTab === "records" && (
        <div className="table-container">
          <div className="table-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>All Revenue Records</h3>
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
                  style={{ minWidth: 180, padding: "6px 10px", fontSize: 13 }}>
                  <option value="">All Categories</option>
                  {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Source / Search</label>
                <input className="form-input" placeholder="Search source..." value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)} style={{ minWidth: 200, padding: "6px 10px", fontSize: 13 }} />
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
                {filterSource && (
                  <span style={{
                    padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600,
                    background: "rgba(99,102,241,0.15)", color: "var(--brand-primary)",
                  }}>&quot;{filterSource}&quot;</span>
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
          {loading ? (
            <div style={{ marginTop: 24 }}><SkeletonTable rows={4} /></div>
          ) : (
            <DataTable
              columns={[
                {
                  header: "Month",
                  accessorKey: "month",
                  cell: (row) => <span style={{ fontWeight: 600 }}>{new Date(row.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>,
                },
                {
                  header: "Type",
                  accessorKey: "type",
                  cell: (row) => <span className={`badge ${row.type === "recurring" ? "sent" : "draft"}`}>{row.type}</span>,
                },
                {
                  header: "Category",
                  accessorKey: "category",
                  cell: (row) => row.category ? (
                    <span style={{
                      padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: `${CATEGORY_COLORS[row.category] || "#6B7280"}20`,
                      color: CATEGORY_COLORS[row.category] || "#6B7280",
                    }} onClick={(e) => { e.stopPropagation(); setFilterCategory(row.category!); setShowFilters(true); }}>
                      {row.category}
                    </span>
                  ) : <span style={{ color: "var(--text-muted)" }}>—</span>,
                },
                {
                  header: "Source",
                  accessorKey: "source",
                  cell: (row) => <span style={{ color: "var(--text-secondary)", maxWidth: 200, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{extractClientName(row.source || "")}</span>,
                },
                {
                  header: "Client",
                  accessorKey: "client",
                  cell: (row) => <span>{row.client?.name || "—"}</span>,
                },
                {
                  header: "Amount",
                  accessorKey: "amount",
                  align: "right",
                  cell: (row) => <span style={{ fontWeight: 700, color: "var(--accent-green)" }}>{formatCurrency(Number(row.amount))}</span>,
                },
              ] as ColumnDef<Revenue>[]}
              data={filteredRevenues.slice(0, 100)}
              onRowClick={(row) => setSelectedRevenue(row)}
              emptyState={
                hasActiveFilters ? (
                  <div className="empty-state" style={{ padding: 40, border: "none" }}>
                    <h3>No revenue matches your filters</h3>
                    <p>Try adjusting your filter criteria</p>
                    <button className="btn btn-primary btn-sm" onClick={clearFilters}><X size={14} /> Clear Filters</button>
                  </div>
                ) : (
                  <EmptyState
                    icon={DollarSign}
                    title="No revenue tracked yet"
                    description="Import bank statements or record revenue manually to start tracking your income."
                    action={
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                        <a href="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                          Import Statement
                        </a>
                        <button className="btn btn-secondary" onClick={() => setShowCreate(true)}>
                          <Plus size={16} /> Record Revenue
                        </button>
                      </div>
                    }
                  />
                )
              }
            />
          )}
          {!loading && filteredRevenues.length > 100 && (
            <div style={{ textAlign: "center", padding: 12, fontSize: 12, color: "var(--text-secondary)" }}>Showing 100 of {filteredRevenues.length} records.</div>
          )}
        </div>
      )}

      {/* Create Revenue Modal */}
      {showCreate && (
        <AccessibleModal open={showCreate} onClose={() => setShowCreate(false)} titleId="create-revenue-title">
            <div className="modal-header">
              <h3 id="create-revenue-title">Record Revenue</h3>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)} aria-label="Close revenue form"><X size={20} aria-hidden="true" /></button>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Month</label>
                <input className="form-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Amount (₹)</label>
                <input className="form-input" type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-input" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="recurring">Recurring (MRR)</option>
                  <option value="one-time">One-Time</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select category</option>
                  {REVENUE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Source</label>
                <input className="form-input" placeholder="e.g., Product, Consulting" value={source} onChange={(e) => setSource(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createRevenue}><TrendingUp size={16} /> Record</button>
            </div>
        </AccessibleModal>
      )}
    </div>
    <RevenueDetailDrawer
      open={!!selectedRevenue}
      onClose={() => setSelectedRevenue(null)}
      item={selectedRevenue ? { ...selectedRevenue, amount: Number(selectedRevenue.amount) } : null}
    />
    </>
  );
}
