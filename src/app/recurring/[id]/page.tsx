"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, RefreshCw, Edit3, Save, X, Plus, Tag, Layers, Trash2,
  BarChart3, Play, Pause, ArrowRightLeft,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";
import { AliasSuggestions } from "@/components/alias-suggestions";

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

interface RecurringDetail {
  item: {
    id: string; description: string; amount: number; currency: string;
    frequency: string; startDate: string; endDate?: string; nextDueDate: string;
    isActive: boolean; vendor?: string; categoryId?: string; notes?: string;
    aliases?: string; bucketName?: string;
  };
  matchedTransactions: { date: string; description: string; amount: number; matchedVia?: string | null }[];
  monthlySpend: { month: string; amount: number }[];
  totalSpent: number;
  txnCount: number;
}

export default function RecurringDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const id = params.id as string;

  const [data, setData] = useState<RecurringDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recurring-expenses/${id}`);
      const d = await res.json();
      setData(d);
      const item = d.item;
      setEditForm({
        description: item.description || "", amount: String(item.amount || 0),
        frequency: item.frequency || "monthly", vendor: item.vendor || "",
        notes: item.notes || "", bucketName: item.bucketName || "",
        currency: item.currency || "INR",
      });
      try { setAliases(JSON.parse(item.aliases || "[]")); } catch { setAliases([]); }
    } catch { toast("Failed to load item", "error"); }
    finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  async function saveItem() {
    setSaving(true);
    try {
      const res = await fetch(`/api/recurring-expenses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          amount: Number(editForm.amount) || 0,
          aliases: JSON.stringify(aliases),
        }),
      });
      if (!res.ok) { toast("Failed to save", "error"); return; }
      toast("Updated", "success");
      setEditing(false);
      load();
    } catch { toast("Failed to save", "error"); }
    finally { setSaving(false); }
  }

  async function toggleActive() {
    try {
      await fetch(`/api/recurring-expenses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !data?.item.isActive }),
      });
      toast(data?.item.isActive ? "Paused" : "Resumed", "success");
      load();
    } catch { toast("Failed", "error"); }
  }

  function addAlias() {
    const a = newAlias.trim();
    if (a && !aliases.includes(a)) { setAliases([...aliases, a]); setNewAlias(""); }
  }

  async function transferToPayroll() {
    const ok = await confirm({ title: "Transfer to Payroll?", message: `Transfer "${data?.item.description}" from Recurring to Payroll? This will delete the recurring expense and create a payroll entry.`, confirmLabel: "Transfer", destructive: true });
    if (!ok) return;
    try {
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: "recurring", sourceId: id, targetType: "payroll" }),
      });
      const d = await res.json();
      if (!res.ok) { toast(d.error || "Transfer failed", "error"); return; }
      toast("Transferred to Payroll", "success");
      router.push(`/payroll/${d.newId}`);
    } catch { toast("Transfer failed", "error"); }
  }

  async function deleteItem() {
    const ok = await confirm({ title: "Delete Recurring Expense?", message: `Permanently delete "${data?.item.description}"? This cannot be undone.`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/recurring-expenses/${id}`, { method: "DELETE" });
      if (!res.ok) { toast("Failed to delete", "error"); return; }
      toast("Recurring expense deleted", "success");
      router.push("/recurring");
    } catch { toast("Failed to delete", "error"); }
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-secondary)" }}>Loading...</div>;
  if (!data) return <div style={{ padding: 60, textAlign: "center" }}>Item not found</div>;

  const item = data.item;

  return (
    <>
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={() => router.push("/recurring")} style={{
          background: "var(--bg-secondary)", border: "none", borderRadius: 8, padding: "8px 12px",
          cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4,
        }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <RefreshCw size={22} /> {item.description}
            <span style={{
              padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
              background: item.isActive ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              color: item.isActive ? "#22C55E" : "#EF4444",
            }}>
              {item.isActive ? "ACTIVE" : "PAUSED"}
            </span>
            <span style={{
              padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
              background: "rgba(99,102,241,0.15)", color: "#818CF8",
            }}>
              {item.frequency.toUpperCase()}
            </span>
          </h2>
          {item.vendor && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Vendor: {item.vendor}</p>}
          {item.bucketName && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <Layers size={12} /> Bucket: <strong>{item.bucketName}</strong>
            </p>
          )}
        </div>
        <button className="btn btn-secondary" onClick={toggleActive}>
          {item.isActive ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
        </button>
        <button className="btn btn-secondary" onClick={transferToPayroll} style={{ color: "#F59E0B" }}>
          <ArrowRightLeft size={14} /> Move to Payroll
        </button>
        {!editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-secondary" onClick={() => setEditing(true)}><Edit3 size={14} /> Edit</button>
            <button className="btn btn-danger" onClick={deleteItem} style={{ padding: "6px 12px" }}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" onClick={saveItem} disabled={saving}><Save size={14} /> {saving ? "Saving..." : "Save"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}><X size={14} /> Cancel</button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-label">Expected Amount</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(item.amount)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Spent (Bank)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(data.totalSpent)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Matched Txns</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{data.txnCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Next Due</div>
          <div className="kpi-value" style={{ fontSize: 16 }}>
            {new Date(item.nextDueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
      </div>

      {/* Edit Section */}
      {editing && (
        <div style={{ padding: 24, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)", marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Edit Recurring Expense</h3>
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              ["Description", "description"], ["Amount", "amount"], ["Vendor", "vendor"],
              ["Currency", "currency"],
            ].map(([label, key]) => (
              <div key={key}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>{label}</label>
                <input className="input" value={editForm[key] || ""} onChange={(ev) => setEditForm({ ...editForm, [key]: ev.target.value })}
                  type={key === "amount" ? "number" : "text"} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Frequency</label>
              <select className="input" value={editForm.frequency} onChange={(ev) => setEditForm({ ...editForm, frequency: ev.target.value })}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>

          {/* Bucket */}
          <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 8 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Layers size={14} /> Bucket Group
              <span style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 400 }}>
                (combine CGST, SGST, base into one head)
              </span>
            </h4>
            <input className="input" placeholder="e.g. Commission, OpenAI, Vercel" value={editForm.bucketName || ""}
              onChange={(ev) => setEditForm({ ...editForm, bucketName: ev.target.value })} />
            <AliasSuggestions
              type="recurring"
              currentAliases={editForm.bucketName ? [editForm.bucketName] : []}
              onAdd={(val: string) => setEditForm({ ...editForm, bucketName: val })}
              entityName={data?.item.description}
            />
          </div>

          {/* Aliases */}
          <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 8 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Tag size={14} /> Aliases
              <span style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 400 }}>
                (names that mean the same expense)
              </span>
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {aliases.map(a => (
                <span key={a} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, background: "rgba(99,102,241,0.15)", color: "#818CF8", display: "flex", alignItems: "center", gap: 4 }}>
                  {a}
                  <button onClick={() => setAliases(aliases.filter(x => x !== a))} aria-label={`Remove alias ${a}`} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 0 }}><X size={10} aria-hidden="true" /></button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" placeholder="e.g. OpenAI Chat, OPEN A I" value={newAlias} onChange={(ev) => setNewAlias(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addAlias(); } }} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={addAlias} style={{ padding: "6px 12px" }}><Plus size={14} /> Add</button>
            </div>
            <AliasSuggestions type="recurring" currentAliases={aliases} onAdd={(a) => { if (!aliases.includes(a)) setAliases([...aliases, a]); }} entityName={data?.item.description} />
          </div>

          {/* Notes */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Notes</label>
            <textarea className="input" rows={2} value={editForm.notes || ""} onChange={(ev) => setEditForm({ ...editForm, notes: ev.target.value })} style={{ width: "100%", resize: "vertical" }} />
          </div>
        </div>
      )}

      {/* Monthly Chart */}
      {data.monthlySpend.length > 0 && (
        <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)", marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart3 size={16} /> Monthly Spend
          </h3>
          <div style={{ height: 200 }}>
            <ChartAccessibilityWrapper label={`Monthly spend history for ${item.description}`} data={data.monthlySpend} dataKeys={["month", "amount"]}>
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

      {/* Transaction Table */}
      <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Matched Bank Transactions ({data.matchedTransactions.length})</h3>
        {data.matchedTransactions.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No matching bank transactions found. Try adding aliases to improve matching.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {data.matchedTransactions.map((t, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)", fontSize: 13 }}>
                      {new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {t.description}
                      {t.matchedVia && (
                        <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "rgba(168,85,247,0.15)", color: "#A855F7" }}>
                          via {t.matchedVia}
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
