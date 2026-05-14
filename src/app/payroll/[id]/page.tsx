"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Users, Edit3, Save, X, Plus, Tag, Trash2,
  BarChart3, ArrowRightLeft,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ChartAccessibilityWrapper } from "@/components/chart-a11y-wrapper";
import { AliasSuggestions } from "@/components/alias-suggestions";

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

interface EmployeeDetail {
  employee: {
    id: string; employeeId: string; name: string; email?: string; phone?: string;
    designation?: string; department?: string; basicSalary: number; hra: number;
    ctc: number; isActive: boolean; type: string; paymentBasis?: string;
    aliases?: string;
  };
  totalPaid: number;
  txnCount: number;
  avgPayment: number;
  isConsistent: boolean;
  monthlyPayments: { month: string; amount: number }[];
  transactions: { date: string; description: string; amount: number; category?: string; categoryColor?: string; matchedVia?: string | null }[];
}

export default function PayrollDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const id = params.id as string;

  const [data, setData] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/payroll/${id}`);
      const d = await res.json();
      setData(d);
      const e = d.employee;
      setEditForm({
        name: e.name || "", email: e.email || "", phone: e.phone || "",
        designation: e.designation || "", department: e.department || "",
        basicSalary: String(e.basicSalary || 0), hra: String(e.hra || 0),
        ctc: String(e.ctc || 0), type: e.type || "employee",
        paymentBasis: e.paymentBasis || "fixed",
      });
      try { setAliases(JSON.parse(e.aliases || "[]")); } catch { setAliases([]); }
    } catch { toast("Failed to load employee", "error"); }
    finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  async function saveEmployee() {
    setSaving(true);
    try {
      const res = await fetch(`/api/payroll/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          basicSalary: Number(editForm.basicSalary) || 0,
          hra: Number(editForm.hra) || 0,
          ctc: Number(editForm.ctc) || 0,
          aliases: JSON.stringify(aliases),
        }),
      });
      if (!res.ok) { toast("Failed to save", "error"); return; }
      toast("Employee updated", "success");
      setEditing(false);
      load();
    } catch { toast("Failed to save", "error"); }
    finally { setSaving(false); }
  }

  function addAlias() {
    const a = newAlias.trim();
    if (a && !aliases.includes(a)) { setAliases([...aliases, a]); setNewAlias(""); }
  }

  async function transferToRecurring() {
    const ok = await confirm({ title: "Transfer to Recurring?", message: `Transfer "${data?.employee.name}" from Payroll to Recurring Expenses? This will delete the payroll entry and create a recurring expense.`, confirmLabel: "Transfer", destructive: true });
    if (!ok) return;
    try {
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: "payroll", sourceId: id, targetType: "recurring" }),
      });
      const d = await res.json();
      if (!res.ok) { toast(d.error || "Transfer failed", "error"); return; }
      toast("Transferred to Recurring Expenses", "success");
      router.push(`/recurring/${d.newId}`);
    } catch { toast("Transfer failed", "error"); }
  }

  async function deleteEmployee() {
    const ok = await confirm({ title: "Delete Employee?", message: `Permanently delete "${data?.employee.name}"? This cannot be undone.`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/payroll/${id}`, { method: "DELETE" });
      if (!res.ok) { toast("Failed to delete", "error"); return; }
      toast("Employee deleted", "success");
      router.push("/payroll");
    } catch { toast("Failed to delete", "error"); }
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-secondary)" }}>Loading...</div>;
  if (!data) return <div style={{ padding: 60, textAlign: "center" }}>Employee not found</div>;

  const e = data.employee;

  return (
    <>
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={() => router.push("/payroll")} style={{
          background: "var(--bg-secondary)", border: "none", borderRadius: 8, padding: "8px 12px",
          cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4,
        }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={22} /> {e.name}
            <span style={{
              padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
              background: e.type === "contractor" ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)",
              color: e.type === "contractor" ? "#F59E0B" : "#22C55E",
            }}>
              {e.type === "contractor" ? "Contractor" : "Employee"}
            </span>
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
            {e.employeeId} · {e.designation || "—"} · {e.department || "—"}
          </p>
        </div>
        {!editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-secondary" onClick={transferToRecurring} style={{ color: "#F59E0B" }}>
              <ArrowRightLeft size={14} /> Move to Recurring
            </button>
            <button className="btn btn-secondary" onClick={() => setEditing(true)}><Edit3 size={14} /> Edit</button>
            <button className="btn btn-danger" onClick={deleteEmployee} style={{ padding: "6px 12px" }}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" onClick={saveEmployee} disabled={saving}><Save size={14} /> {saving ? "Saving..." : "Save"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}><X size={14} /> Cancel</button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Paid (Bank)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(data.totalPaid)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Bank Transactions</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{data.txnCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Payment</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{data.txnCount > 0 ? fmt(data.avgPayment) : "—"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Annual CTC</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(e.ctc)}</div>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <div style={{ padding: 24, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)", marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Edit Employee</h3>
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              ["Name", "name"], ["Email", "email"], ["Phone", "phone"],
              ["Designation", "designation"], ["Department", "department"],
              ["Basic Salary", "basicSalary"], ["HRA", "hra"], ["Annual CTC", "ctc"],
            ].map(([label, key]) => (
              <div key={key}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>{label}</label>
                <input className="input" value={editForm[key] || ""} onChange={(ev) => setEditForm({ ...editForm, [key]: ev.target.value })}
                  type={["basicSalary", "hra", "ctc"].includes(key) ? "number" : "text"} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Type</label>
              <select className="input" value={editForm.type} onChange={(ev) => setEditForm({ ...editForm, type: ev.target.value })}>
                <option value="employee">Employee</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
          </div>

          {/* Aliases */}
          <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 8 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Tag size={14} /> Aliases <span style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 400 }}>(alternate names in bank)</span>
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
              <input className="input" placeholder="Add bank name alias" value={newAlias} onChange={(ev) => setNewAlias(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addAlias(); } }} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={addAlias} style={{ padding: "6px 12px" }}><Plus size={14} /> Add</button>
            </div>
            <AliasSuggestions type="payroll" currentAliases={aliases} onAdd={(a) => { if (!aliases.includes(a)) setAliases([...aliases, a]); }} entityName={data?.employee.name} />
          </div>
        </div>
      )}

      {/* Monthly Chart */}
      {data.monthlyPayments.length > 0 && (
        <div style={{ padding: 20, background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border-color)", marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart3 size={16} /> Monthly Payments
            {data.isConsistent && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(34,197,94,0.15)", color: "#22C55E", fontWeight: 700 }}>CONSISTENT</span>}
            {!data.isConsistent && data.txnCount > 1 && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>VARIABLE</span>}
          </h3>
          <div style={{ height: 200 }}>
            <ChartAccessibilityWrapper label={`Monthly payment history for ${e.name}`} data={data.monthlyPayments} dataKeys={["month", "amount"]}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthlyPayments}>
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
        <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Bank Transactions ({data.transactions.length})</h3>
        {data.transactions.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No matching bank transactions found for this employee</p>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {data.transactions.map((t, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)", fontSize: 13 }}>
                      {new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {t.description}
                      {t.matchedVia && (
                        <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "rgba(249,115,22,0.15)", color: "#F97316" }}>
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
  /* eslint-disable-next-line no-unreachable -- Fragment wrapper is required */
}
