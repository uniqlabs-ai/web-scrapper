"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, X, Building2, Users, Save, Settings2,
  Shield, Bell, Link2, CheckCircle, AlertCircle, ExternalLink, Landmark, Mail, Send
} from "lucide-react";
import { useToast } from "@/components/toast";
import { SkeletonTable } from "@/components/skeleton";
import { formatCurrency } from "@/lib/currency";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AccessibleModal } from "@/components/accessible-modal";

interface BankAccountSummary {
  id: string;
  name: string;
  bankName: string | null;
  accountType: string | null;
  accountLast4: string | null;
  currentBalance: string;
  _count?: { transactions: number };
}

interface Client {
  id: string;
  name: string;
  email?: string;
  company?: string;
  gstNumber?: string;
}

interface OrgSettings {
  name: string;
  currency: string;
  gstNumber: string;
  address: string;
  logoUrl: string;
  cashInBank?: number;
  alertSettings: string;
}

type Tab = "accounts" | "clients" | "organization" | "integrations" | "team";

interface TeamUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  permissions: string | null;
  createdAt: string;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("organization");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [bankAccounts, setBankAccounts] = useState<BankAccountSummary[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showAddClient, setShowAddClient] = useState(false);

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [clientGst, setClientGst] = useState("");

  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [showEditUser, setShowEditUser] = useState<TeamUser | null>(null);
  const [editingRole, setEditingRole] = useState<string>("viewer");
  const [editingPermissions, setEditingPermissions] = useState<string[]>([]);

  const [org, setOrg] = useState<OrgSettings>({
    name: "", currency: "INR", gstNumber: "", address: "", logoUrl: "", alertSettings: "{}"
  });
  const [hasResend, setHasResend] = useState(false);
  const [runwayWarning, setRunwayWarning] = useState(3);
  const [budgetThreshold, setBudgetThreshold] = useState(80);

  // CFO Brief settings
  const [cfoBriefEnabled, setCfoBriefEnabled] = useState(false);
  const [cfoBriefEmail, setCfoBriefEmail] = useState("");
  const [cfoBriefDay, setCfoBriefDay] = useState("monday");
  const [cfoBriefSending, setCfoBriefSending] = useState(false);
  const [cfoBriefSent, setCfoBriefSent] = useState(false);

  // New Year 1 feature settings
  const [invoiceReminders, setInvoiceReminders] = useState<number[]>([1, 7, 15]);
  const [paymentUpiId, setPaymentUpiId] = useState("");
  const [cleartaxApiKey, setCleartaxApiKey] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/bank/accounts").then((r) => r.json()).catch(() => []),
      fetch("/api/clients").then((r) => r.json()).catch(() => ({ clients: [] })),
      fetch("/api/settings/organization").then((r) => r.json()).catch(() => ({})),
      fetch("/api/users").then((r) => r.json()).catch(() => ({ users: [] })),
    ]).then(([bankData, clData, orgData, userData]) => {
      setBankAccounts(Array.isArray(bankData) ? bankData : []);
      setClients(clData?.clients || []);
      setTeamUsers(userData?.users || []);
      setHasResend(orgData?.hasResend || false);
      if (orgData?.organization) {
        setOrg(orgData.organization);
        try {
          const alerts = JSON.parse(orgData.organization.alertSettings || "{}");
          setRunwayWarning(alerts.runwayWarningMonths ?? 3);
          setBudgetThreshold((alerts.budgetAlertThreshold ?? 0.8) * 100);
          setCfoBriefEnabled(alerts.cfoBriefEnabled ?? false);
          setCfoBriefEmail(alerts.cfoBriefEmail || "");
          setCfoBriefDay(alerts.cfoBriefDay || "monday");
          setInvoiceReminders(alerts.invoiceReminders || [1, 7, 15]);
          setPaymentUpiId(alerts.paymentUpiId || "");
          setCleartaxApiKey(alerts.cleartaxApiKey || "");
        } catch { /* ignore */ }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveOrg = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings/organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...org,
          alertSettings: JSON.stringify({
            runwayWarningMonths: runwayWarning,
            budgetAlertThreshold: budgetThreshold / 100,
            cfoBriefEnabled,
            cfoBriefEmail,
            cfoBriefDay,
            invoiceReminders,
            paymentUpiId,
            cleartaxApiKey,
          }),
        }),
      });
      toast("Organization settings saved", "success");
    } catch {
      toast("Failed to save settings", "error");
    }
    setSaving(false);
  };

  const totalBalance = bankAccounts.reduce((s, a) => s + Number(a.currentBalance || 0), 0);

  const addClient = async () => {
    if (!clientName) return;
    await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: clientName, email: clientEmail, company: clientCompany, gstNumber: clientGst }),
    });
    setShowAddClient(false);
    setClientName(""); setClientEmail(""); setClientCompany(""); setClientGst("");
    const r = await fetch("/api/clients");
    const d = await r.json();
    setClients(d.clients || []);
    toast("Client added successfully", "success");
  };

  const saveUserRole = async () => {
    if (!showEditUser) return;
    await fetch(`/api/users/${showEditUser.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: editingRole,
        permissions: editingRole === "custom" ? editingPermissions : null,
      }),
    });
    setShowEditUser(null);
    const r = await fetch("/api/users");
    const d = await r.json();
    setTeamUsers(d.users || []);
    toast("User permissions updated", "success");
  };

  const AVAILABLE_MODULES = [
    { id: "dashboard", label: "Dashboard" },
    { id: "invoices", label: "Invoices" },
    { id: "expenses", label: "Expenses" },
    { id: "bank", label: "Bank Integration" },
    { id: "reconciliation", label: "Bank Reconciliation" },
    { id: "payroll", label: "Payroll Engine" },
    { id: "accounting", label: "Accounting Engine" },
    { id: "settings", label: "Settings & Administration" },
  ];

  const fmtCurrency = (n: number | string) => formatCurrency(Number(n), "INR", { decimals: 2 });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "organization", label: "Organization", icon: <Building2 size={16} /> },
    { id: "team", label: "Team & Access", icon: <Shield size={16} /> },
    { id: "accounts", label: "Bank Accounts", icon: <Landmark size={16} /> },
    { id: "clients", label: "Clients", icon: <Users size={16} /> },
    { id: "integrations", label: "Integrations", icon: <Link2 size={16} /> },
  ];

  return (
    <div>
      <PageHeader title="Settings" description="Manage organization, accounts, clients, and integrations" />

      {/* Tab navigation */}
      <div style={{
        display: "flex",
        gap: 4,
        marginBottom: 24,
        background: "var(--bg-secondary)",
        padding: 4,
        borderRadius: "var(--radius)",
        width: "fit-content",
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
              background: activeTab === tab.id ? "var(--bg-card)" : "transparent",
              color: activeTab === tab.id ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Organization Tab */}
      {activeTab === "organization" && (
        <div className="table-container" style={{ marginBottom: 32 }}>
          <div className="table-header">
            <h3><Building2 size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />Company Profile</h3>
            <button className="btn btn-primary btn-sm" onClick={saveOrg} disabled={saving}>
              <Save size={14} /> {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Company Name</label>
                <input className="form-input" placeholder="Your company name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-input" value={org.currency} onChange={(e) => setOrg({ ...org, currency: e.target.value })}>
                  <option value="INR">₹ INR</option>
                  <option value="USD">$ USD</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">GSTIN</label>
                <input className="form-input" placeholder="22AAAAA0000A1Z5" value={org.gstNumber || ""} onChange={(e) => setOrg({ ...org, gstNumber: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Cash in Bank (₹)</label>
                <input className="form-input" type="number" placeholder="0" value={org.cashInBank || ""} onChange={(e) => setOrg({ ...org, cashInBank: Number(e.target.value) })} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Address</label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Company address..."
                value={org.address || ""}
                onChange={(e) => setOrg({ ...org, address: e.target.value })}
                style={{ resize: "vertical" }}
              />
            </div>

            <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 20 }}>
              <h4 style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Bell size={16} /> Alert Thresholds
              </h4>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Runway Warning (months)</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    max={24}
                    value={runwayWarning}
                    onChange={(e) => setRunwayWarning(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Alert when runway drops below this
                  </span>
                </div>
                <div className="form-group">
                  <label className="form-label">Budget Alert (%)</label>
                  <input
                    className="form-input"
                    type="number"
                    min={50}
                    max={100}
                    value={budgetThreshold}
                    onChange={(e) => setBudgetThreshold(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Alert when spending exceeds this % of budget
                  </span>
                </div>
              </div>
            </div>

            {/* Weekly CFO Brief */}
            <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 20 }}>
              <h4 style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Mail size={16} /> Weekly CFO Brief
              </h4>
              <div style={{ padding: 16, borderRadius: 10, background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.15)", marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  Receive an automated weekly financial summary covering cash position, runway, expenses, revenue, receivables, and alerts.
                  Preview the report on the <span style={{ color: "var(--brand-primary)", cursor: "pointer" }} onClick={() => router.push("/health")}>Health Score</span> page.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={cfoBriefEnabled}
                    onChange={(e) => setCfoBriefEnabled(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: "var(--brand-primary)" }}
                  />
                  Enable weekly email
                </label>
              </div>
              {cfoBriefEnabled && (
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Recipient Email</label>
                    <input
                      className="form-input"
                      type="email"
                      placeholder="founder@company.com"
                      value={cfoBriefEmail}
                      onChange={(e) => { setCfoBriefEmail(e.target.value); setCfoBriefSent(false); }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Send Day</label>
                    <select className="form-input" value={cfoBriefDay} onChange={(e) => setCfoBriefDay(e.target.value)}>
                      <option value="monday">Monday</option>
                      <option value="tuesday">Tuesday</option>
                      <option value="wednesday">Wednesday</option>
                      <option value="thursday">Thursday</option>
                      <option value="friday">Friday</option>
                      <option value="saturday">Saturday</option>
                      <option value="sunday">Sunday</option>
                    </select>
                  </div>
                </div>
              )}
              {cfoBriefEnabled && cfoBriefEmail && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={cfoBriefSending || cfoBriefSent}
                  onClick={async () => {
                    setCfoBriefSending(true);
                    try {
                      const res = await fetch("/api/reports/cfo-brief", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: cfoBriefEmail }),
                      });
                      if (res.ok) {
                        setCfoBriefSent(true);
                        toast("Test brief sent!", "success");
                      } else {
                        toast("Failed to send — check RESEND_API_KEY", "error");
                      }
                    } catch {
                      toast("Failed to send", "error");
                    }
                    setCfoBriefSending(false);
                  }}
                  style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Send size={12} />
                  {cfoBriefSent ? "Test Sent ✓" : cfoBriefSending ? "Sending..." : "Send Test Brief"}
                </button>
              )}
            </div>

            {/* Invoice Customization */}
            <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 20 }}>
              <h4 style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Landmark size={16} /> Invoice & Collections
              </h4>
              <div className="form-group">
                <label className="form-label">Auto-Follow-Up Sequences</label>
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  {[1, 3, 7, 15, 30].map(day => (
                    <label key={day} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={invoiceReminders.includes(day)}
                        onChange={(e) => {
                          if (e.target.checked) setInvoiceReminders([...invoiceReminders, day].sort((a,b)=>a-b));
                          else setInvoiceReminders(invoiceReminders.filter(d => d !== day));
                        }}
                        style={{ accentColor: "var(--brand-primary)" }}
                      />
                      Day {day}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                  Automatically send email reminders when invoices become this many days overdue.
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 16 }}>
                <label className="form-label">Default Payment UPI ID</label>
                <input
                  className="form-input"
                  placeholder="name@okbank"
                  value={paymentUpiId}
                  onChange={(e) => setPaymentUpiId(e.target.value)}
                />
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  Generates an embedded standard UPI payment intent link/QR code on your invoices automatically.
                </div>
              </div>
            </div>

            {/* Compliance Integrations */}
            <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 20 }}>
              <h4 style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Shield size={16} /> Compliance Integrations (ClearTax)
              </h4>
              <div className="form-group">
                <label className="form-label">ClearTax API Key</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="prod_xxxx_xxxx"
                  value={cleartaxApiKey}
                  onChange={(e) => setCleartaxApiKey(e.target.value)}
                />
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  Connect your ClearTax account to directly file GSTR-1, push GSTR-3B JSON, and generate E-Invoices.
                </div>
              </div>
            </div>
            
          </div>
        </div>
      )}

      {/* Bank Accounts Tab — Summary + Link to Bank Page */}
      {activeTab === "accounts" && (
        <div className="table-container" style={{ marginBottom: 32 }}>
          <div className="table-header">
            <h3><Landmark size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />Bank Accounts</h3>
            <button className="btn btn-primary btn-sm" onClick={() => router.push("/bank")}>
              <ExternalLink size={14} /> Manage Accounts
            </button>
          </div>
          {loading ? (
            <SkeletonTable rows={3} />
          ) : bankAccounts.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No bank accounts yet"
              description="Add bank accounts to track transactions, import statements, and sync Gmail alerts"
              action={<button className="btn btn-primary btn-sm" onClick={() => router.push("/bank")}><Plus size={14} /> Add Account in Bank Module</button>}
            />
          ) : (
            <>
              <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-primary)", display: "flex", gap: 24 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Total Balance</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent-green)" }}>{fmtCurrency(totalBalance)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Accounts</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{bankAccounts.length}</div>
                </div>
              </div>
              <table>
                <thead>
                  <tr><th scope="col">Bank</th><th scope="col">Account</th><th scope="col">Type</th><th scope="col">Balance</th><th scope="col">Transactions</th></tr>
                </thead>
                <tbody>
                  {bankAccounts.map((acc) => (
                    <tr key={acc.id} style={{ cursor: "pointer" }} onClick={() => router.push("/bank")}>
                      <td style={{ fontWeight: 600 }}>{acc.bankName || acc.name}</td>
                      <td style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>
                        {acc.accountLast4 ? `••••${acc.accountLast4}` : "—"}
                      </td>
                      <td>
                        <span className="badge sent" style={{ textTransform: "capitalize" }}>
                          {acc.accountType || "bank"}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700 }}>{fmtCurrency(acc.currentBalance)}</td>
                      <td style={{ color: "var(--text-secondary)" }}>{acc._count?.transactions ?? 0} txns</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border-primary)", textAlign: "center" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => router.push("/bank")}
                  style={{ color: "var(--accent-blue)", gap: 6 }}
                >
                  <ExternalLink size={14} /> Manage accounts, import statements & sync Gmail →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Clients Tab */}
      {activeTab === "clients" && (
        <div className="table-container">
          <div className="table-header">
            <h3><Users size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />Clients</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddClient(true)}>
              <Plus size={14} /> Add Client
            </button>
          </div>
          {loading ? (
            <SkeletonTable rows={4} />
          ) : clients.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No clients yet"
              description="Add clients to associate with invoices and revenue"
              action={<button className="btn btn-primary btn-sm" onClick={() => setShowAddClient(true)}><Plus size={14} /> Add First Client</button>}
            />
          ) : (
            <table>
              <thead>
                <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Company</th><th scope="col">GST No.</th></tr>
              </thead>
              <tbody>
                {clients.map((cl) => (
                  <tr key={cl.id}>
                    <td style={{ fontWeight: 600 }}>{cl.name}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{cl.email || "—"}</td>
                    <td>{cl.company || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{cl.gstNumber || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Team & Access Tab */}
      {activeTab === "team" && (
        <div className="table-container">
          <div className="table-header">
            <h3><Shield size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />Team Members & Roles</h3>
          </div>
          {loading ? (
            <SkeletonTable rows={4} />
          ) : teamUsers.length === 0 ? (
            <EmptyState icon={Users} title="No team members yet" description="Users are automatically added once they sign in via SSO." />
          ) : (
            <table>
              <thead>
                <tr><th scope="col">User</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Actions</th></tr>
              </thead>
              <tbody>
                {teamUsers.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.fullName || "User"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role === "admin" ? "success" : u.role === "custom" ? "pending" : "sent"}`} style={{ textTransform: "capitalize" }}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => {
                        setShowEditUser(u);
                        setEditingRole(u.role);
                        setEditingPermissions(u.permissions ? JSON.parse(u.permissions) : []);
                      }}>Configure Access</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === "integrations" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {[
            {
              name: "Founder OS Orchestrator",
              desc: "Heartbeat Protocol events & copilot APIs",
              status: !!process.env.NEXT_PUBLIC_ORCHESTRATOR_URL,
              icon: <Shield size={20} />,
            },
            {
              name: "NextAuth / Google OAuth",
              desc: "User authentication",
              status: true,
              icon: <Shield size={20} />,
            },
            {
              name: "Resend Email",
              desc: "Invoice email delivery",
              status: hasResend,
              icon: <Link2 size={20} />,
              envKey: "RESEND_API_KEY",
            },
          ].map((integration) => (
            <div
              key={integration.name}
              className="table-container"
              style={{ padding: 20 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius)",
                  background: integration.status
                    ? "rgba(34, 197, 94, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: integration.status ? "#22c55e" : "#ef4444",
                }}>
                  {integration.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{integration.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{integration.desc}</div>
                </div>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  color: integration.status ? "#22c55e" : "var(--text-muted)",
                }}>
                  {integration.status ? (
                    <><CheckCircle size={14} /> Connected</>
                  ) : (
                    <><AlertCircle size={14} /> Not configured</>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Account Modal — Removed: users now manage accounts via Bank page */}

      {/* Add Client Modal */}
      {showAddClient && (
        <AccessibleModal open={showAddClient} onClose={() => setShowAddClient(false)} titleId="add-client-title">
            <div className="modal-header">
              <h3 id="add-client-title">Add Client</h3>
              <button className="btn btn-ghost" onClick={() => setShowAddClient(false)} aria-label="Close add client"><X size={20} aria-hidden="true" /></button>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" placeholder="email@company.com" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Company</label>
                <input className="form-input" placeholder="Company name" value={clientCompany} onChange={(e) => setClientCompany(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">GST Number</label>
                <input className="form-input" placeholder="22AAAAA0000A1Z5" value={clientGst} onChange={(e) => setClientGst(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAddClient(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addClient}><Users size={16} /> Add Client</button>
            </div>
        </AccessibleModal>
      )}

      {/* Edit User Modal */}
      {showEditUser && (
        <AccessibleModal open={!!showEditUser} onClose={() => setShowEditUser(null)} titleId="edit-user-title" maxWidth={500}>
            <div className="modal-header">
              <h3 id="edit-user-title">Role & Permissions</h3>
              <button className="btn btn-ghost" onClick={() => setShowEditUser(null)} aria-label="Close permissions editor"><X size={20} aria-hidden="true" /></button>
            </div>
            
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Role Policy</label>
              <select className="form-input" value={editingRole} onChange={(e) => setEditingRole(e.target.value)}>
                <option value="admin">Full Admin Authority</option>
                <option value="accountant">Standard Accountant (Blocked from Payroll/Settings)</option>
                <option value="viewer">Viewer Only</option>
                <option value="custom">Custom Module Access</option>
              </select>
            </div>

            {editingRole === "custom" && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--border-primary)", paddingTop: 16 }}>
                <label className="form-label">Allowed Modules</label>
                <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                  {AVAILABLE_MODULES.map((mod) => (
                    <label key={mod.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={editingPermissions.includes(mod.id)}
                        onChange={(e) => {
                          if (e.target.checked) setEditingPermissions([...editingPermissions, mod.id]);
                          else setEditingPermissions(editingPermissions.filter(p => p !== mod.id));
                        }}
                        style={{ accentColor: "var(--brand-primary)" }}
                      />
                      {mod.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-footer" style={{ marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setShowEditUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveUserRole}><Save size={16} /> Save Policy</button>
            </div>
        </AccessibleModal>
      )}
    </div>
  );
}
