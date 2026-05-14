"use client";

import { useState, useEffect, useCallback } from "react";

import { Contact2, Plus, Trash2, Mail, Phone, Building, FileText, Search, DollarSign, RefreshCw } from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { SkeletonCard } from "@/components/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DetailDrawer } from "@/components/detail-drawer";
// import { DateRangeFilter } from "@/components/date-range-filter";

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  gstNumber: string | null;
  address: string | null;
  invoices?: { id: string; invoiceNumber: string; total: number; currency: string; status: string; issueDate: string }[];
  revenues?: { id: string; amount: string; month: string; type: string; source: string }[];
  totalInvoiced?: number;
  totalRevenue?: number;
  invoiceCount?: number;
  revenueCount?: number;
  latestInvoiceCurrency?: string;
}

import { formatCurrency } from "@/lib/currency";

export default function ClientsPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", gstNumber: "", address: "" });


  // Detail drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerData, setDrawerData] = useState<{
    entityId: string; title: string; subtitle?: string; totalAmount: number; txnCount: number;
    monthlyData: { month: string; amount: number }[];
    categoryData: { name: string; value: number }[];
    transactions: { date: string; description: string; amount: number; category?: string; categoryColor?: string; currency?: string }[];
    currency?: string;
  } | null>(null);
  const [dateRange] = useState({ from: "", to: "", label: "All Time" });

  async function openClientDetail(client: Client) {
    try {
      const res = await fetch(`/api/clients/${client.id}`);
      const data = await res.json();
      setDrawerData({
        entityId: client.id,
        title: client.name,
        subtitle: client.company || undefined,
        totalAmount: data.totalInvoiced || 0,
        txnCount: data.txnCount || 0,
        monthlyData: data.monthlyRevenue || [],
        categoryData: data.statusBreakdown || [],
        transactions: data.transactions || [],
        currency: data.invoiceCurrency || data.currency || "INR",
      });
      setDrawerOpen(true);
    } catch (err) {
      console.error(err);
      toast("Failed to load client details", "error");
    }
  }

  const fetchClients = useCallback(() => {
    const params = new URLSearchParams();
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    const qs = params.toString();
    fetch(`/api/clients${qs ? `?${qs}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setClients(d.clients || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dateRange]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.company?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (!form.name.trim()) {
      toast("Client name is required", "error");
      return;
    }
    fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
      .then((r) => r.json())
      .then(() => {
        toast("Client created!", "success");
        setShowModal(false);
        setForm({ name: "", email: "", phone: "", company: "", gstNumber: "", address: "" });
        fetchClients();
      })
      .catch(() => toast("Failed to create client", "error"));
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({ title: "Delete Client?", message: `Are you sure you want to delete "${name}"? This will unlink their invoices.`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    fetch(`/api/clients/${id}`, { method: "DELETE" })
      .then(() => {
        toast("Client deleted", "success");
        fetchClients();
      })
      .catch(() => toast("Failed to delete", "error"));
  };

  // Calculate stats
  const totalBilled = clients.reduce((sum, c) => sum + (c.totalInvoiced || 0), 0);
  const totalRevenue = clients.reduce((sum, c) => sum + (c.totalRevenue || 0), 0);

  const activeClients = clients.filter((c) => (c.invoices?.length || 0) > 0).length;

  return (
    <div>
      <PageHeader title="Clients" description="Manage your clients and track billing">
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Client
        </button>
      </PageHeader>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card blue">
          <div className="kpi-label">TOTAL CLIENTS</div>
          <div className="kpi-value">{clients.length}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">ACTIVE (WITH INVOICES)</div>
          <div className="kpi-value">{activeClients}</div>
        </div>
        <div className="kpi-card purple">
          <div className="kpi-label">TOTAL INVOICED</div>
          <div className="kpi-value">
            {(() => {
              const byCurrency: Record<string, number> = {};
              clients.forEach(c => {
                const cur = c.latestInvoiceCurrency || "INR";
                byCurrency[cur] = (byCurrency[cur] || 0) + (c.totalInvoiced || 0);
              });
              const entries = Object.entries(byCurrency).filter(([, v]) => v > 0);
              if (entries.length <= 1) return formatCurrency(totalBilled, entries[0]?.[0] || "INR");
              return entries.map(([cur, amt]) => formatCurrency(amt, cur)).join(" + ");
            })()}
          </div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label">TOTAL REVENUE (BANK)</div>
          <div className="kpi-value">{formatCurrency(totalRevenue)}</div>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20, position: "relative" }}>
        <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-muted)" }} />
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search clients"
          style={{
            width: 300, paddingLeft: 36,
            background: "var(--bg-card)", border: "1px solid var(--border-color)",
            borderRadius: 8, padding: "10px 12px 10px 36px", color: "var(--text-primary)",
          }}
        />
      </div>

      {/* Client Cards */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Contact2}
          title={clients.length === 0 ? "No clients yet" : "No matches"}
          description={clients.length === 0 ? "Add your first client to start tracking billing" : "Try a different search term"}
          action={clients.length === 0 ? <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add Client</button> : undefined}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {filtered.map((client) => {

            return (
              <div key={client.id} className="table-container" style={{ padding: 20, cursor: "pointer" }}
                onClick={() => openClientDetail(client)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <h3 style={{ marginBottom: 4, fontSize: 16 }}>{client.name}</h3>
                    {client.company && (
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                        <Building size={12} /> {client.company}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-danger"
                    style={{ padding: "6px 8px", fontSize: 12 }}
                    onClick={() => handleDelete(client.id, client.name)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                  {client.email && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Mail size={12} /> {client.email}
                    </div>
                  )}
                  {client.phone && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Phone size={12} /> {client.phone}
                    </div>
                  )}
                  {client.gstNumber && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <FileText size={12} /> GSTIN: {client.gstNumber}
                    </div>
                  )}
                </div>

                {/* Billing summary row */}
                <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, borderTop: "1px solid var(--border-color)", paddingTop: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
                      <FileText size={10} /> Invoices
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{client.invoiceCount || 0}</div>
                    <div style={{ fontSize: 12, color: "var(--accent-green)", fontWeight: 600 }}>
                      {formatCurrency(client.totalInvoiced || 0, client.latestInvoiceCurrency || "INR")}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
                      <DollarSign size={10} /> Revenue
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{client.revenueCount || 0}</div>
                    <div style={{ fontSize: 12, color: "var(--accent-green)", fontWeight: 600 }}>
                      {formatCurrency(client.totalRevenue || 0)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
                      <RefreshCw size={10} /> Recurring
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {client.revenues?.filter(r => r.type === "recurring").length || 0}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--brand-primary)", fontWeight: 600 }}>
                      {formatCurrency(client.revenues?.filter(r => r.type === "recurring").reduce((s, r) => s + Number(r.amount), 0) || 0)}
                    </div>
                  </div>
                </div>

                {/* Recent invoices */}
                {(client.invoices?.length || 0) > 0 && (
                  <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 8 }}>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Recent Invoices</div>
                    {client.invoices!.slice(0, 3).map(inv => (
                      <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: "var(--text-secondary)" }}>
                        <span>{inv.invoiceNumber}</span>
                        <span style={{ display: "flex", gap: 8 }}>
                          <span style={{ color: inv.status === "paid" ? "var(--accent-green)" : "var(--accent-amber)", fontWeight: 600 }}>{inv.status}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(Number(inv.total), inv.currency || "INR")}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Client Modal */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }} onClick={() => setShowModal(false)}>
          <div className="responsive-modal" role="dialog" aria-label="Add new client" style={{
            background: "var(--bg-card)", borderRadius: 16, padding: 32,
            width: 480, maxHeight: "85vh", overflow: "auto",
            border: "1px solid var(--border-color)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 24 }}>Add New Client</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>
                  Client Name *
                </label>
                <input
                  type="text" placeholder="e.g. Sequoia Capital India"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "10px 12px", color: "var(--text-primary)" }}
                />
              </div>
              <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Email</label>
                  <input
                    type="email" placeholder="finance@client.com"
                    value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "10px 12px", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Phone</label>
                  <input
                    type="tel" placeholder="+91 98765 43210"
                    value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "10px 12px", color: "var(--text-primary)" }}
                  />
                </div>
              </div>
              <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Company</label>
                  <input
                    type="text" placeholder="Company name"
                    value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                    style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "10px 12px", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>GSTIN</label>
                  <input
                    type="text" placeholder="29AABCU9603R1ZP"
                    value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })}
                    style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "10px 12px", color: "var(--text-primary)" }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Address</label>
                <textarea
                  placeholder="Full address..."
                  value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  rows={2}
                  style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "10px 12px", color: "var(--text-primary)", resize: "vertical" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Plus size={16} /> Create Client
              </button>
            </div>
          </div>
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
          totalLabel="Total Revenue"
          txnCount={drawerData.txnCount}
          monthlyData={drawerData.monthlyData}
          categoryData={drawerData.categoryData}
          transactions={drawerData.transactions}
          type="revenue"
          currency={drawerData.currency}
          detailUrl={`/clients/${drawerData.entityId}`}
        />
      )}
    </div>
  );
}
