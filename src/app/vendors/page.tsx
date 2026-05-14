"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";

import {
  Plus,
  X,
  Building2,
  Phone,
  Mail,
  CreditCard,
  Search,
  MoreVertical,
  Trash2,
  Eye,

  Sparkles,
  Check,
  EyeOff,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { DetailDrawer } from "@/components/detail-drawer";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface Vendor {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  gstNumber?: string;
  panNumber?: string;
  paymentTerms: number;
  isActive: boolean;
  totalSpent: number;
  expenseCount: number;
}

interface DetectedVendor {
  name: string;
  avgAmount: number;
  totalAmount: number;
  count: number;
  distinctMonths: number;
  frequency: string;
}

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

export default function VendorsPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [_expandedId] = useState<string | null>(null);

  // Detail drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerData, setDrawerData] = useState<{
    vendorId: string; title: string; subtitle?: string; totalAmount: number; txnCount: number;
    monthlyData: { month: string; amount: number }[];
    categoryData: { name: string; value: number }[];
    transactions: { date: string; description: string; amount: number; category?: string; categoryColor?: string }[];
  } | null>(null);

  // Date range
  const [dateRange, setDateRange] = useState({ from: "", to: "", label: "All Time" });

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("30");

  // Suggestions from bank data
  const [suggestions, setSuggestions] = useState<DetectedVendor[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function loadVendors() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.from) params.set("from", dateRange.from);
      if (dateRange.to) params.set("to", dateRange.to);
      const qs = params.toString();
      const res = await fetch(`/api/vendors${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      setVendors(data.vendors || []);
    } catch (err) {
      clientLog.error("Failed to load vendors", "vendors", "load", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadVendors(); }, [dateRange]);

  // Load suggestions + dismissed
  useEffect(() => {
    try {
      const stored = localStorage.getItem("dismissed_vendors");
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
    fetch("/api/detect-recurring").then(r => r.json()).then(data => {
      setSuggestions(data.vendors || []);
    }).catch((err: unknown) => clientLog.error("Failed to load fingerprints", "vendors", "fingerprints", err));
  }, [vendors]);

  async function acceptVendor(s: DetectedVendor) {
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name }),
      });
      if (!res.ok) { toast("Failed to add", "error"); return; }
      toast(`"${s.name}" added as vendor`, "success");
      loadVendors();
    } catch { toast("Failed", "error"); }
  }

  function dismissVendor(name: string) {
    const next = new Set(dismissed);
    next.add(name);
    setDismissed(next);
    try { localStorage.setItem("dismissed_vendors", JSON.stringify([...next])); } catch { /* ignore */ }
  }

  const visibleSuggestions = suggestions.filter(s => !dismissed.has(s.name));

  async function createVendor() {
    if (!name.trim()) return;
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email: email || undefined, phone: phone || undefined,
          company: company || undefined, gstNumber: gstNumber || undefined,
          panNumber: panNumber || undefined, paymentTerms: Number(paymentTerms) || 30,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast(err.error || "Failed to create vendor", "error");
        return;
      }
      toast("Vendor created", "success");
      setShowForm(false);
      setName(""); setEmail(""); setPhone(""); setCompany("");
      setGstNumber(""); setPanNumber(""); setPaymentTerms("30");
      loadVendors();
    } catch (err) {
      clientLog.error("Failed to create vendor", "vendors", "create", err);
      toast("Failed to create vendor", "error");
    }
  }

  async function deleteVendor(id: string, vendorName: string) {
    const ok = await confirm({ title: "Delete Vendor?", message: `Are you sure you want to delete "${vendorName}"?`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      await fetch(`/api/vendors?id=${id}`, { method: "DELETE" });
      toast("Vendor deleted", "success");
      loadVendors();
    } catch (err) {
      clientLog.error("Failed to delete vendor", "vendors", "delete", err);
    }
  }

  const filtered = vendors.filter(
    (v) =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.company?.toLowerCase().includes(search.toLowerCase()) ||
      v.email?.toLowerCase().includes(search.toLowerCase())
  );

  const totalSpending = vendors.reduce((sum, v) => sum + v.totalSpent, 0);

  async function openVendorDetail(v: Vendor) {
    try {
      const res = await fetch(`/api/vendors/${v.id}`);
      const data = await res.json();
      setDrawerData({
        vendorId: v.id,
        title: v.name,
        subtitle: v.company || undefined,
        totalAmount: data.totalSpent || 0,
        txnCount: data.txnCount || 0,
        monthlyData: data.monthlySpend || [],
        categoryData: data.categoryBreakdown || [],
        transactions: data.transactions || [],
      });
      setDrawerOpen(true);
    } catch (err) {
      clientLog.error("Failed to apply fingerprint", "vendors", "apply-fingerprint", err);
      toast("Failed to load vendor details", "error");
    }
  }

  return (
    <div>
      <PageHeader title="Vendors" description="Manage suppliers and track spending">
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Add Vendor
        </button>
      </PageHeader>
      {/* Create Form */}
      {showForm && (
        <div style={{
          padding: 24, marginBottom: 24, background: "var(--bg-card)",
          borderRadius: 12, border: "1px solid var(--border-color)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>New Vendor</h3>
            <button aria-label="Close vendor form" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }} onClick={() => setShowForm(false)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Name *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Company</label>
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vendor@company.com" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Phone</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>GST Number</label>
              <input className="input" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="29AABCU9603R1ZM" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>PAN Number</label>
              <input className="input" value={panNumber} onChange={(e) => setPanNumber(e.target.value)} placeholder="ABCDE1234F" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>Payment Terms (days)</label>
              <input className="input" type="number" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={createVendor} disabled={!name.trim()}>Create Vendor</button>
          </div>
        </div>
      )}

      {/* Suggestions from Bank Data */}
      {visibleSuggestions.length > 0 && (
        <div style={{
          marginBottom: 24, padding: 20, background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))",
          borderRadius: 12, border: "1px solid rgba(99,102,241,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Sparkles size={18} color="#818CF8" />
            <h3 style={{ margin: 0, fontSize: 15 }}>Detected Vendors from Bank</h3>
            <span style={{ fontSize: 11, color: "var(--text-secondary)", background: "rgba(99,102,241,0.15)", padding: "2px 8px", borderRadius: 10 }}>
              {visibleSuggestions.length} found
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {visibleSuggestions.slice(0, 24).map(s => (
              <div key={s.name} style={{
                padding: 14, background: "var(--bg-card)", borderRadius: 10,
                border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                  <span>Total: {fmt(s.totalAmount)}</span>
                  <span>{s.count} txns</span>
                  <span>{s.distinctMonths} months</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <button
                    onClick={() => acceptVendor(s)}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 600,
                      background: "rgba(34,197,94,0.15)", color: "#22C55E", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                    }}
                  >
                    <Check size={12} /> Accept
                  </button>
                  <button
                    onClick={() => dismissVendor(s.name)}
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
      {/* KPIs */}

      {/* Date Filter */}
      <DateRangeFilter onChange={setDateRange} />
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Vendors</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{vendors.length}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Active</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{vendors.filter((v) => v.isActive).length}</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label">Total Spending</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(totalSpending)}</div>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16, position: "relative" }}>
        <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendors..."
          style={{ paddingLeft: 36 }}
        />
      </div>

      {/* Vendor List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>Loading vendors...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={vendors.length === 0 ? "No vendors yet" : "No matches"}
          description={vendors.length === 0 ? "Add your first vendor to start tracking spending" : "Try a different search term"}
          action={vendors.length === 0 ? <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Add Vendor</button> : undefined}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {filtered.map((v) => (
            <div
              key={v.id}
              style={{
                padding: 20, background: "var(--bg-card)", borderRadius: 12,
                border: "1px solid var(--border-color)", transition: "border-color 0.2s",
                cursor: "pointer",
              }}
              onClick={() => openVendorDetail(v)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h4 style={{ margin: "0 0 4px", fontSize: 15 }}>{v.name}</h4>
                  {v.company && <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>{v.company}</p>}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button
                    onClick={(e) => { e.stopPropagation(); deleteVendor(v.id, v.name); }}
                    aria-label={`Delete vendor ${v.name}`}
                    style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 4 }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                  <MoreVertical size={14} style={{ color: "var(--text-tertiary)" }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>TOTAL SPENT</p>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{fmt(v.totalSpent)}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>TRANSACTIONS</p>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{v.expenseCount}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>TERMS</p>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{v.paymentTerms}d</p>
                </div>
              </div>

              {_expandedId === v.id && (
                <div style={{ marginTop: 16, padding: "12px 0 0", borderTop: "1px solid var(--border-color)", fontSize: 12 }}>
                  {v.email && <p style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6 }}><Mail size={12} /> {v.email}</p>}
                  {v.phone && <p style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6 }}><Phone size={12} /> {v.phone}</p>}
                  {v.gstNumber && <p style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6 }}><CreditCard size={12} /> GST: {v.gstNumber}</p>}
                  {v.panNumber && <p style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6 }}><Eye size={12} /> PAN: {v.panNumber}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {confirmDialog}

      {/* Detail Drawer */}
      {drawerData && (
        <DetailDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={drawerData.title}
          subtitle={drawerData.subtitle}
          totalAmount={drawerData.totalAmount}
          totalLabel="Total Spent"
          txnCount={drawerData.txnCount}
          monthlyData={drawerData.monthlyData}
          categoryData={drawerData.categoryData}
          transactions={drawerData.transactions}
          detailUrl={`/vendors/${drawerData.vendorId}`}
        />
      )}
    </div>
  );
}
