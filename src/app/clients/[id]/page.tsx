"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Contact2, Edit3, Save, X, Tag, Trash2,
  BarChart3, PieChart as PieChartIcon,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";
import { AliasSuggestions } from "@/components/alias-suggestions";

const PIE_COLORS = ["#22C55E", "#F59E0B", "#818CF8", "#EF4444", "#06B6D4", "#A855F7"];
import { formatCurrency } from "@/lib/currency";

interface ClientDetail {
  client: {
    id: string; name: string; email?: string; phone?: string; company?: string;
    gstNumber?: string; address?: string; displayName?: string; aliases?: string;
  };
  totalInvoiced: number;
  totalRevenue: number;
  totalAmount: number;
  txnCount: number;
  monthlyRevenue: { month: string; amount: number }[];
  statusBreakdown: { name: string; value: number }[];
  transactions: { date: string; description: string; amount: number; category?: string; categoryColor?: string; currency?: string }[];
  currency: string;
  invoiceCurrency?: string;
  revenueCurrency?: string;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const id = params.id as string;

  const [data, setData] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${id}`);
      const d = await res.json();
      setData(d);
      const c = d.client;
      setEditForm({
        name: c.name || "", displayName: c.displayName || "",
        email: c.email || "", phone: c.phone || "",
        company: c.company || "", gstNumber: c.gstNumber || "",
        address: c.address || "",
      });
      try { setAliases(JSON.parse(c.aliases || "[]")); } catch { setAliases([]); }
    } catch { toast("Failed to load client", "error"); }
    finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  async function saveClient() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          aliases: JSON.stringify(aliases),
        }),
      });
      if (!res.ok) { toast("Failed to save", "error"); return; }
      toast("Client updated", "success");
      setEditing(false);
      load();
    } catch { toast("Failed to save", "error"); }
    finally { setSaving(false); }
  }

  async function deleteClient() {
    const ok = await confirm({ title: "Delete Client?", message: `Permanently delete "${data?.client.name}"? This will unlink all invoices. This cannot be undone.`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      if (!res.ok) { toast("Failed to delete", "error"); return; }
      toast("Client deleted", "success");
      router.push("/clients");
    } catch { toast("Failed to delete", "error"); }
  }

  function addAlias() {
    const a = newAlias.trim();
    if (a && !aliases.includes(a)) { setAliases([...aliases, a]); setNewAlias(""); }
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-secondary)" }}>Loading...</div>;
  if (!data) return <div style={{ padding: 60, textAlign: "center" }}>Client not found</div>;

  const c = data.client;
  const invoiceCurrency = data.invoiceCurrency || data.currency || "INR";
  const revenueCurrency = data.revenueCurrency || "INR";

  return (
    <>
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={() => router.push("/clients")} style={{
          background: "var(--bg-secondary)", border: "none", borderRadius: 8, padding: "8px 12px",
          cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4,
        }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <Contact2 size={22} /> {c.displayName || c.name}
          </h2>
          {c.displayName && c.displayName !== c.name && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>{c.name}</p>
          )}
          {c.company && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>{c.company}</p>}
        </div>
        {!editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-secondary" onClick={() => setEditing(true)}><Edit3 size={14} /> Edit</button>
            <button className="btn btn-danger" onClick={deleteClient} style={{ padding: "6px 12px" }}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" onClick={saveClient} disabled={saving}><Save size={14} /> {saving ? "Saving..." : "Save"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}><X size={14} /> Cancel</button>
          </div>
        )}
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card green">
          <div className="kpi-label">Total Combined</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>
            {invoiceCurrency !== revenueCurrency
              ? `${formatCurrency(data.totalInvoiced, invoiceCurrency)} + ${formatCurrency(data.totalRevenue, revenueCurrency)}`
              : formatCurrency(data.totalAmount, invoiceCurrency)}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Invoiced ({invoiceCurrency})</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatCurrency(data.totalInvoiced, invoiceCurrency)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Revenue (Bank — {revenueCurrency})</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatCurrency(data.totalRevenue, revenueCurrency)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Transactions</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{data.txnCount}</div>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <div style={{ padding: 24, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)", marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Edit Client</h3>
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              ["Display Name", "displayName"], ["Legal Name", "name"], ["Company", "company"],
              ["Email", "email"], ["Phone", "phone"], ["GST Number", "gstNumber"],
            ].map(([label, key]) => (
              <div key={key}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>{label}</label>
                <input className="input" value={editForm[key] || ""} onChange={(ev) => setEditForm({ ...editForm, [key]: ev.target.value })} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Address</label>
            <textarea className="input" rows={2} value={editForm.address || ""} onChange={(ev) => setEditForm({ ...editForm, address: ev.target.value })} style={{ width: "100%", resize: "vertical" }} />
          </div>

          {/* Aliases */}
          <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 8 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Tag size={14} /> Aliases <span style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 400 }}>(alternate names in bank/invoices)</span>
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {aliases.map(a => (
                <span key={a} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, background: "rgba(34,197,94,0.15)", color: "#22C55E", display: "flex", alignItems: "center", gap: 4 }}>
                  {a}
                  <button onClick={() => setAliases(aliases.filter(x => x !== a))} aria-label={`Remove alias ${a}`} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 0 }}><X size={10} aria-hidden="true" /></button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" placeholder="Add alias" value={newAlias} onChange={(ev) => setNewAlias(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addAlias(); } }} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={addAlias} style={{ padding: "6px 12px" }}>Add</button>
            </div>
            <AliasSuggestions type="client" currentAliases={aliases} onAdd={(a) => { if (!aliases.includes(a)) setAliases([...aliases, a]); }} entityName={data?.client.name} />
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {data.monthlyRevenue.length > 0 && (
          <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 size={16} /> Monthly Revenue
            </h3>
            <div style={{ height: 200 }}>
              <ChartAccessibilityWrapper label={`Monthly revenue from ${c.displayName || c.name}`} data={data.monthlyRevenue} dataKeys={["month", "amount"]}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} width={60} />
                  <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => formatCurrency(Number(v), invoiceCurrency)} />
                  <Bar dataKey="amount" fill="#22C55E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </ChartAccessibilityWrapper>
            </div>
          </div>
        )}
        {data.statusBreakdown.length > 0 && (
          <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <PieChartIcon size={16} /> Invoice Status
            </h3>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ width: 140, height: 140 }}>
                <ChartAccessibilityWrapper label={`Invoice status breakdown for ${c.displayName || c.name}`} data={data.statusBreakdown} dataKeys={["name", "value"]}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.statusBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                      {data.statusBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => formatCurrency(Number(v), invoiceCurrency)} />
                  </PieChart>
                </ResponsiveContainer>
                </ChartAccessibilityWrapper>
              </div>
              <div style={{ flex: 1 }}>
                {data.statusBreakdown.map((s, i) => (
                  <div key={s.name} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span style={{ color: "var(--text-secondary)" }}>{s.name}</span>
                    </div>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(s.value, invoiceCurrency)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Transactions */}
      <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Invoices & Revenue ({data.transactions.length})</h3>
        {data.transactions.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No transactions found</p>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Type</th><th scope="col" style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {data.transactions.map((t, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)", fontSize: 13 }}>
                      {new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                    </td>
                    <td style={{ fontSize: 13 }}>{t.description}</td>
                    <td>
                      {t.category && (
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${t.categoryColor || "#818CF8"}20`, color: t.categoryColor || "#818CF8" }}>
                          {t.category}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600, fontSize: 13 }}>{formatCurrency(t.amount, t.currency || "INR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    {confirmDialog}
    </>
  );
}
