"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, Edit3, Save, X, Plus, Trash2, Tag,
  BarChart3, PieChart as PieChartIcon,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";
// import { DateRangeFilter } from "@/components/date-range-filter";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";
import { AliasSuggestions } from "@/components/alias-suggestions";

const PIE_COLORS = ["#818CF8", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#A855F7", "#EC4899", "#14B8A6"];
import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

interface VendorDetail {
  vendor: {
    id: string; name: string; email?: string; phone?: string; company?: string;
    gstNumber?: string; panNumber?: string; bankName?: string; bankAccount?: string;
    bankIfsc?: string; paymentTerms: number; address?: string; notes?: string;
    aliases?: string; displayName?: string; isActive: boolean;
  };
  totalSpent: number;
  txnCount: number;
  monthlySpend: { month: string; amount: number }[];
  categoryBreakdown: { name: string; value: number }[];
  transactions: { date: string; description: string; amount: number; category?: string; categoryColor?: string }[];
}

export default function VendorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const id = params.id as string;

  const [data, setData] = useState<VendorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendors/${id}`);
      const d = await res.json();
      setData(d);
      const v = d.vendor;
      setEditForm({
        name: v.name || "", email: v.email || "", phone: v.phone || "",
        company: v.company || "", gstNumber: v.gstNumber || "", panNumber: v.panNumber || "",
        bankName: v.bankName || "", bankAccount: v.bankAccount || "", bankIfsc: v.bankIfsc || "",
        paymentTerms: String(v.paymentTerms || 30), address: v.address || "", notes: v.notes || "",
        displayName: v.displayName || "",
      });
      try { setAliases(JSON.parse(v.aliases || "[]")); } catch { setAliases([]); }
    } catch { toast("Failed to load vendor", "error"); }
    finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  async function saveVendor() {
    setSaving(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          ...editForm,
          paymentTerms: Number(editForm.paymentTerms) || 30,
          aliases: JSON.stringify(aliases),
        }),
      });
      if (!res.ok) { toast("Failed to save", "error"); return; }
      toast("Vendor updated", "success");
      setEditing(false);
      load();
    } catch { toast("Failed to save", "error"); }
    finally { setSaving(false); }
  }

  function addAlias() {
    const a = newAlias.trim();
    if (a && !aliases.includes(a)) {
      setAliases([...aliases, a]);
      setNewAlias("");
    }
  }

  function removeAlias(a: string) {
    setAliases(aliases.filter(x => x !== a));
  }

  async function deleteVendor() {
    const ok = await confirm({ title: "Delete Vendor?", message: `Permanently delete "${data?.vendor.name}"? This cannot be undone.`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      const res = await fetch("/api/vendors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) { toast("Failed to delete", "error"); return; }
      toast("Vendor deleted", "success");
      router.push("/vendors");
    } catch { toast("Failed to delete", "error"); }
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-secondary)" }}>Loading vendor...</div>;
  if (!data) return <div style={{ padding: 60, textAlign: "center" }}>Vendor not found</div>;

  const v = data.vendor;

  return (
    <>
    <div>
      {/* Back + Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={() => router.push("/vendors")} style={{
          background: "var(--bg-secondary)", border: "none", borderRadius: 8, padding: "8px 12px",
          cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4,
        }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <Building2 size={22} />
            {v.displayName || v.name}
          </h2>
          {v.displayName && v.displayName !== v.name && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>{v.name}</p>
          )}
        </div>
        {!editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              <Edit3 size={14} /> Edit
            </button>
            <button className="btn btn-danger" onClick={deleteVendor} style={{ padding: "6px 12px" }}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" onClick={saveVendor} disabled={saving}>
              <Save size={14} /> {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>
              <X size={14} /> Cancel
            </button>
          </div>
        )}
      </div>

      {/* KPI Row */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Spent</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(data.totalSpent)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Transactions</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{data.txnCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg/Txn</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{data.txnCount > 0 ? fmt(data.totalSpent / data.txnCount) : "—"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Payment Terms</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{v.paymentTerms}d</div>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <div style={{ padding: 24, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)", marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Edit Vendor Details</h3>
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              ["Display Name", "displayName"], ["Legal Name", "name"], ["Company", "company"],
              ["Email", "email"], ["Phone", "phone"], ["GST Number", "gstNumber"],
              ["PAN Number", "panNumber"], ["Bank Name", "bankName"], ["Bank Account", "bankAccount"],
              ["IFSC", "bankIfsc"], ["Payment Terms (days)", "paymentTerms"],
            ].map(([label, key]) => (
              <div key={key}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>{label}</label>
                <input className="input" value={editForm[key] || ""} onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Address</label>
            <textarea className="input" rows={2} value={editForm.address || ""} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} style={{ width: "100%", resize: "vertical" }} />
          </div>

          {/* Aliases */}
          <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 8 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Tag size={14} /> Aliases
              <span style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 400 }}>
                (alternate names in bank statements)
              </span>
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {aliases.map(a => (
                <span key={a} style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  background: "rgba(99,102,241,0.15)", color: "#818CF8",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  {a}
                  <button onClick={() => removeAlias(a)} aria-label={`Remove alias ${a}`} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 0 }}>
                    <X size={10} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" placeholder="Add alias (e.g. AMAZON PAY INDIA)" value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-secondary" onClick={addAlias} style={{ padding: "6px 12px" }}>
                <Plus size={14} /> Add
              </button>
            </div>
            <AliasSuggestions type="vendor" currentAliases={aliases} onAdd={(a) => { if (!aliases.includes(a)) setAliases([...aliases, a]); }} entityName={data?.vendor.name} />
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {data.monthlySpend.length > 0 && (
          <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 size={16} /> Monthly Spend
            </h3>
            <div style={{ height: 200 }}>
              <ChartAccessibilityWrapper label={`Monthly spend with ${v.displayName || v.name}`} data={data.monthlySpend} dataKeys={["month", "amount"]}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlySpend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} width={60} />
                  <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => fmt(Number(v))} />
                  <Bar dataKey="amount" fill="#818CF8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </ChartAccessibilityWrapper>
            </div>
          </div>
        )}
        {data.categoryBreakdown.length > 0 && (
          <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <PieChartIcon size={16} /> Category Breakdown
            </h3>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ width: 140, height: 140 }}>
                <ChartAccessibilityWrapper label={`Expense category breakdown for ${v.displayName || v.name}`} data={data.categoryBreakdown} dataKeys={["name", "value"]}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.categoryBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                      {data.categoryBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1E1B4B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E8F0" }} formatter={(v: unknown) => fmt(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                </ChartAccessibilityWrapper>
              </div>
              <div style={{ flex: 1 }}>
                {data.categoryBreakdown.slice(0, 8).map((c, i) => (
                  <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span style={{ color: "var(--text-secondary)" }}>{c.name}</span>
                    </div>
                    <span style={{ fontWeight: 600 }}>{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Transaction Table */}
      <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>All Transactions ({data.transactions.length})</h3>
        {data.transactions.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No transactions linked to this vendor</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Category</th>
                  <th scope="col" style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)", fontSize: 13 }}>
                      {new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>{t.description}</td>
                    <td>
                      {t.category && (
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: t.categoryColor ? `${t.categoryColor}20` : "rgba(99,102,241,0.15)",
                          color: t.categoryColor || "#818CF8",
                        }}>
                          {t.category}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600, fontSize: 13 }}>{fmt(t.amount)}</td>
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
