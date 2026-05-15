"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  CheckCircle2,
  Circle,
  Building2,
  TrendingUp,
  TrendingDown,
  Wallet,
  FileSpreadsheet,
  RefreshCw,
  Sparkles,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Mail,
  Loader2,
  Link as LinkIcon,
  Unlink,
  Plus,
  CreditCard,
  Landmark,
  Edit3,
  Trash2,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/page-header";
import { DataTable, ColumnDef } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StaggerContainer, SlideUp } from "@/components/animations";

/* ──────────────────────────── Types ──────────────────────────── */

interface BankAccountRecord {
  id: string;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  accountLast4: string | null;
  accountType: string;
  ifscCode: string | null;
  bankEmailDomains: string | null;
  currentBalance: number;
  isActive: boolean;
  _count: { transactions: number };
}

interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  balance?: number;
  category: string | null;
  vendor: string | null;
  isReconciled: boolean;
  confidence?: number;
  reference?: string;
  bankAccount?: { name: string; bankName: string };
}

interface TransactionSummary {
  totalDebit: number;
  totalCredit: number;
  transactionCount: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  Payroll: "#6366F1",
  "Rent & Office": "#8B5CF6",
  "Software & SaaS": "#A855F7",
  "Cloud & Infra": "#EC4899",
  Marketing: "#F43F5E",
  Travel: "#EF4444",
  "Food & Meals": "#F97316",
  "Telecom & Internet": "#F59E0B",
  Insurance: "#EAB308",
  "Professional Services": "#84CC16",
  Utilities: "#22C55E",
  "Bank Charges": "#14B8A6",
  "Tax Payments": "#06B6D4",
  "Equipment & Supplies": "#3B82F6",
  "Loan & EMI": "#64748B",
  Investment: "#10B981",
  "Internal Transfer": "#94A3B8",
  "Income / Revenue": "#22C55E",
  "Client Payment": "#22C55E",
  Uncategorized: "#9CA3AF",
};

interface ConflictTransaction {
  description: string;
  date: string | Date;
  type: string;
  amount: number;
  category?: string | null;
  vendor?: string | null;
  reference?: string | null;
  hash?: string | null;
  bankAccountId?: string;
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "Savings",
  current: "Current",
  overdraft: "Overdraft",
  cc: "Credit Card",
  other: "Other",
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  savings: "#22C55E",
  current: "#6366F1",
  overdraft: "#F59E0B",
  cc: "#EC4899",
  other: "#94A3B8",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ──────────────────────── Add Account Modal ──────────────────── */

function AddAccountModal({
  onClose,
  onSave,
  editAccount,
  toast,
}: {
  onClose: () => void;
  onSave: (account: BankAccountRecord) => void;
  editAccount?: BankAccountRecord | null;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [name, setName] = useState(editAccount?.name || "");
  const [bankName, setBankName] = useState(editAccount?.bankName || "");
  const [accountNumber, setAccountNumber] = useState(editAccount?.accountNumber || "");
  const [accountType, setAccountType] = useState(editAccount?.accountType || "savings");
  const [ifscCode, setIfscCode] = useState(editAccount?.ifscCode || "");
  const [bankEmailDomains, setBankEmailDomains] = useState(editAccount?.bankEmailDomains || "");
  const [currentBalance, setCurrentBalance] = useState(
    editAccount ? String(editAccount.currentBalance) : ""
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bankName.trim()) return;

    setSaving(true);
    try {
      const method = editAccount ? "PUT" : "POST";
      const body: Record<string, unknown> = {
        name: name.trim() || `${bankName.trim()} ${ACCOUNT_TYPE_LABELS[accountType] || ""} Account`,
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim() || null,
        accountType,
        ifscCode: ifscCode.trim() || null,
        bankEmailDomains: bankEmailDomains.trim() || null,
        currentBalance: currentBalance ? parseFloat(currentBalance) : 0,
      };
      if (editAccount) body.id = editAccount.id;

      const res = await fetch("/api/bank/accounts", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        onSave(data);
      } else {
        toast(data.error || "Failed to save", "error");
      }
    } catch {
      toast("Failed to save account", "error");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    color: "var(--text-primary)",
    fontSize: 14,
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="responsive-modal"
        role="dialog"
        aria-label={editAccount ? "Edit bank account" : "Add bank account"}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: 16,
          padding: 28,
          width: 520,
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--text-primary)" }}>
            {editAccount ? "Edit Account" : "Add Bank Account"}
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Bank Name */}
          <div>
            <label style={labelStyle}>Bank Name *</label>
            <input
              style={inputStyle}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. ICICI, HDFC, SBI, Kotak..."
              required
            />
          </div>

          {/* Account Type + Account Number */}
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>Account Type</label>
              <select
                style={inputStyle}
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              >
                <option value="savings">Savings</option>
                <option value="current">Current</option>
                <option value="overdraft">Overdraft</option>
                <option value="cc">Credit Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Account Number</label>
              <input
                style={inputStyle}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="Full or last 4 digits"
              />
            </div>
          </div>

          {/* Display Name + IFSC */}
          <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>Display Name</label>
              <input
                style={inputStyle}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${bankName || "Bank"} ${ACCOUNT_TYPE_LABELS[accountType] || ""}`}
              />
            </div>
            <div>
              <label style={labelStyle}>IFSC Code</label>
              <input
                style={inputStyle}
                value={ifscCode}
                onChange={(e) => setIfscCode(e.target.value)}
                placeholder="e.g. ICIC0001234"
              />
            </div>
          </div>

          {/* Opening Balance */}
          <div>
            <label style={labelStyle}>Opening Balance (₹)</label>
            <input
              style={inputStyle}
              type="number"
              value={currentBalance}
              onChange={(e) => setCurrentBalance(e.target.value)}
              placeholder="0"
            />
          </div>

          {/* Bank Email Domains (for Gmail matching) */}
          <div>
            <label style={labelStyle}>
              Bank Email Domains{" "}
              <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-muted)" }}>
                (for Gmail sync matching)
              </span>
            </label>
            <input
              style={inputStyle}
              value={bankEmailDomains}
              onChange={(e) => setBankEmailDomains(e.target.value)}
              placeholder="e.g. icicibank.com, icici"
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Comma-separated sender domains. Gmail transaction alerts from these domains will be linked to this account.
            </div>
          </div>

          {/* Submit */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ padding: "10px 20px" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !bankName.trim()}
              style={{ padding: "10px 24px" }}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
              {editAccount ? "Save Changes" : "Add Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ───────────────────── Conflict Resolution Modal ───────────────── */

function ConflictResolutionModal({
  conflicts,
  onClose,
  onResolve,
  toast,
  bankAccountId,
}: {
  conflicts: { incoming: ConflictTransaction; existing: ConflictTransaction }[];
  onClose: () => void;
  onResolve: () => void;
  toast: (msg: string, type?: "success" | "error") => void;
  bankAccountId: string | null;
}) {
  const [resolving, setResolving] = useState<Record<number, boolean>>({});
  const [resolvedIds, setResolvedIds] = useState<Set<number>>(new Set());

  async function handleAction(index: number, action: "skip" | "import") {
    if (action === "skip") {
      setResolvedIds(new Set([...resolvedIds, index]));
      return;
    }

    setResolving({ ...resolving, [index]: true });
    try {
      const tx = conflicts[index].incoming;
      const res = await fetch("/api/bank/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          type: tx.type,
          bankAccountId: bankAccountId || tx.bankAccountId || "",
          category: tx.category,
          vendor: tx.vendor,
          reference: tx.reference,
          hash: tx.hash,
        }),
      });

      if (!res.ok) throw new Error("Failed to import");
      toast("Transaction imported", "success");
      setResolvedIds(new Set([...resolvedIds, index]));
      onResolve(); // trigger refresh
    } catch {
      toast("Error importing transaction", "error");
    } finally {
      setResolving({ ...resolving, [index]: false });
    }
  }

  const allResolved = resolvedIds.size === conflicts.length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        className="responsive-modal"
        role="dialog"
        aria-label="Import conflicts resolution"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: 16,
          padding: 28,
          width: 800,
          maxWidth: "90vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={24} color="#F59E0B" /> Import Conflicts Detected
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
              We found {conflicts.length} transaction(s) that look very similar to ones already in your account.
            </p>
          </div>
          {allResolved && (
            <button onClick={onClose} aria-label="Close bank connection panel" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
              <X size={20} />
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, paddingRight: 8 }}>
          {conflicts.map((c, i) => {
            if (resolvedIds.has(i)) return null;
            return (
              <div key={i} style={{ border: "1px solid var(--border-color)", borderRadius: 12, overflow: "hidden" }}>
                <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                  {/* Incoming */}
                  <div style={{ background: "var(--bg-tertiary)", padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, letterSpacing: "0.5px" }}>INCOMING (NEW)</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.incoming.description}</div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Date: {formatDate(c.incoming.date as string)}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, color: c.incoming.type === "credit" ? "#22C55E" : "var(--text-primary)" }}>
                      {c.incoming.type === "credit" ? "+" : "-"}{formatCurrency(c.incoming.amount)}
                    </div>
                  </div>
                  {/* Existing */}
                  <div style={{ background: "rgba(245, 158, 11, 0.05)", padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", marginBottom: 8, letterSpacing: "0.5px" }}>EXISTING RECORD</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.existing.description}</div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Date: {formatDate(c.existing.date as string)}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, color: c.existing.type === "credit" ? "#22C55E" : "var(--text-primary)" }}>
                      {c.existing.type === "credit" ? "+" : "-"}{formatCurrency(c.existing.amount)}
                    </div>
                  </div>
                </div>
                <div style={{ padding: 12, background: "var(--bg-card)", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button onClick={() => handleAction(i, "skip")} disabled={resolving[i]} className="btn btn-secondary">
                    Skip Duplicate
                  </button>
                  <button onClick={() => handleAction(i, "import")} disabled={resolving[i]} className="btn btn-primary" style={{ background: "#F59E0B", color: "#000" }}>
                    {resolving[i] ? <Loader2 size={16} className="spin" /> : "Import Anyway"}
                  </button>
                </div>
              </div>
            );
          })}
          {allResolved && (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
              <CheckCircle2 size={48} color="#22C55E" style={{ margin: "0 auto 16px" }} />
              All conflicts resolved
              <div style={{ marginTop: 20 }}>
                <button onClick={onClose} className="btn btn-primary">Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── Main Page ──────────────────────── */

export default function BankPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [accounts, setAccounts] = useState<BankAccountRecord[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null); // null = all
  const [dateRange, setDateRange] = useState({ from: "", to: "", label: "All Time" });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccountRecord | null>(null);

  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary>({
    totalDebit: 0,
    totalCredit: 0,
    transactionCount: 0,
  });
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    imported: number;
    skipped: number;
    conflicts?: { incoming: ConflictTransaction; existing: ConflictTransaction }[];
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gmail integration state
  const [gmailStatus, setGmailStatus] = useState<{
    connected: boolean;
    status: string;
    lastSyncAt: string | null;
    syncCount: number;
    email: string | null;
  }>({ connected: false, status: "disconnected", lastSyncAt: null, syncCount: 0, email: null });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; total: number; message: string } | null>(null);

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/bank/accounts");
      const data = await res.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Fetch Gmail status
  useEffect(() => {
    fetch("/api/integrations/gmail")
      .then((r) => r.json())
      .then((d) => { if (d && !d.error) setGmailStatus(d); })
      .catch(() => { });
  }, []);

  const connectGmail = async () => {
    const res = await fetch("/api/integrations/gmail", { method: "POST" });
    const data = await res.json();
    if (data.authUrl) window.location.href = data.authUrl;
  };

  const disconnectGmail = async () => {
    const ok = await confirm({ title: "Disconnect Gmail?", message: "This will stop automatic bank transaction import. You can reconnect anytime.", confirmLabel: "Disconnect", destructive: true });
    if (!ok) return;
    await fetch("/api/integrations/gmail", { method: "DELETE" });
    setGmailStatus({ connected: false, status: "disconnected", lastSyncAt: null, syncCount: 0, email: null });
  };

  const syncGmail = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/gmail/sync", { method: "POST" });
      const data = await res.json();
      setSyncResult(data);
      if (data.synced > 0) {
        fetchTransactions();
        fetchAccounts();
      }
      const statusRes = await fetch("/api/integrations/gmail");
      const statusData = await statusRes.json();
      setGmailStatus(statusData);
    } catch {
      setSyncResult({ synced: 0, total: 0, message: "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  const fetchTransactions = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: "50" });
        if (searchQuery) params.set("search", searchQuery);
        if (typeFilter) params.set("type", typeFilter);
        if (categoryFilter) params.set("category", categoryFilter);
        if (selectedAccountId) params.set("bankAccountId", selectedAccountId);
        if (dateRange.from) params.set("from", dateRange.from);
        if (dateRange.to) params.set("to", dateRange.to);

        const res = await fetch(`/api/bank/transactions?${params}`);
        const data = await res.json();

        setTransactions(data.transactions || []);
        setSummary(data.summary || { totalDebit: 0, totalCredit: 0, transactionCount: 0 });
        setPagination(data.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 });
      } catch (err) {
        clientLog.error("Failed to fetch transactions", "bank", "load-txns", err);
      } finally {
        setLoading(false);
      }
    },
    [searchQuery, typeFilter, categoryFilter, selectedAccountId, dateRange]
  );

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  async function handleFileUpload(file: File) {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedAccountId) formData.append("accountId", selectedAccountId);

      const res = await fetch("/api/bank/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast(data.error || "Import failed", "error");
        return;
      }

      setUploadResult({ imported: data.imported, skipped: data.skipped, conflicts: data.conflicts });
      fetchTransactions();
      fetchAccounts();
    } catch (err) {
      clientLog.error("Failed to upload statement", "bank", "upload", err);
      toast("Failed to upload file", "error");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave() {
    setDragActive(false);
  }

  async function deleteAccount(id: string) {
    const ok = await confirm({ title: "Delete Account?", message: "This will permanently delete this account and all its transactions. This action cannot be undone.", confirmLabel: "Delete Account", destructive: true });
    if (!ok) return;
    await fetch(`/api/bank/accounts?id=${id}`, { method: "DELETE" });
    if (selectedAccountId === id) setSelectedAccountId(null);
    fetchAccounts();
    fetchTransactions();
  }

  // Empty state
  const isEmpty = !loading && transactions.length === 0 && !searchQuery && !typeFilter && !categoryFilter;
  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.currentBalance), 0);
  const totalTxnCount = accounts.reduce((sum, a) => sum + a._count.transactions, 0);

  return (
    <div className="page-container">
      <PageHeader 
        title="Bank Accounts" 
        description="Manage accounts and import transactions from CSV or Gmail"
      >
        <div style={{ display: "flex", gap: 8 }}>
          {gmailStatus.connected ? (
            <button
              className="btn btn-secondary"
              onClick={syncGmail}
              disabled={syncing}
              title={`Connected: ${gmailStatus.email}`}
            >
              {syncing ? <Loader2 size={16} className="spin" /> : <Mail size={16} />}
              {syncing ? "Syncing..." : "Sync Gmail"}
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={connectGmail}>
              <Mail size={16} /> Connect Gmail
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => fetchTransactions(pagination.page)}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={() => { setEditingAccount(null); setShowAddModal(true); }}
          >
            <Plus size={16} /> Add Account
          </button>
        </div>
      </PageHeader>

      <DateRangeFilter onChange={setDateRange} />

      {/* Gmail Connection Banner */}
      {gmailStatus.connected && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            background: "rgba(99, 102, 241, 0.08)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            borderRadius: 12,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <LinkIcon size={16} style={{ color: "#6366F1" }} />
          <span style={{ color: "var(--text-secondary)" }}>
            Connected to <strong style={{ color: "var(--text-primary)" }}>{gmailStatus.email}</strong>
            {gmailStatus.lastSyncAt && (
              <> · Last synced {new Date(gmailStatus.lastSyncAt).toLocaleString("en-IN")}</>
            )}
            {gmailStatus.syncCount > 0 && (
              <> · {gmailStatus.syncCount} transactions imported</>
            )}
          </span>
          <button
            onClick={disconnectGmail}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}
            title="Disconnect Gmail"
          >
            <Unlink size={14} />
          </button>
        </div>
      )}

      {/* Sync Result */}
      {syncResult && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            background: syncResult.synced > 0 ? "rgba(34, 197, 94, 0.1)" : "rgba(245, 158, 11, 0.1)",
            border: `1px solid ${syncResult.synced > 0 ? "rgba(34, 197, 94, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
            borderRadius: 12,
            marginBottom: 16,
            color: syncResult.synced > 0 ? "#22C55E" : "#F59E0B",
          }}
        >
          <Mail size={18} />
          <span>{syncResult.message}</span>
          <button
            onClick={() => setSyncResult(null)}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload Result Toast */}
      {uploadResult && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            background: "rgba(34, 197, 94, 0.1)",
            border: "1px solid rgba(34, 197, 94, 0.3)",
            borderRadius: 12,
            marginBottom: 16,
            color: "#22C55E",
          }}
        >
          <CheckCircle2 size={18} />
          <span>
            Imported <strong>{uploadResult.imported}</strong> transactions
            {uploadResult.skipped > 0 && (
              <> · {uploadResult.skipped} duplicates skipped</>
            )}
            {uploadResult.conflicts && uploadResult.conflicts.length > 0 && (
              <> · <strong style={{ color: "#F59E0B" }}>{uploadResult.conflicts.length} conflicts</strong> detected</>
            )}
          </span>
          <button
            onClick={() => setUploadResult(null)}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Conflict Resolution Modal */}
      {uploadResult && uploadResult.conflicts && uploadResult.conflicts.length > 0 && (
        <ConflictResolutionModal
          conflicts={uploadResult.conflicts}
          onClose={() => setUploadResult(null)}
          onResolve={fetchTransactions}
          toast={toast}
          bankAccountId={selectedAccountId}
        />
      )}

      {/* ─── Accounts Cards Strip ─── */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 8,
          }}
        >
          {/* All Accounts Card */}
          <button
            onClick={() => setSelectedAccountId(null)}
            style={{
              flex: "0 0 auto",
              minWidth: 180,
              padding: "16px 20px",
              borderRadius: 14,
              border: `2px solid ${selectedAccountId === null ? "#6366F1" : "var(--border-color)"}`,
              background: selectedAccountId === null ? "rgba(99, 102, 241, 0.08)" : "var(--bg-card)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.2s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #6366F1, #A855F7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Wallet size={16} color="white" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                All Accounts
              </div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
              {formatCurrency(totalBalance)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {totalTxnCount} transactions · {accounts.length} accounts
            </div>
          </button>

          {/* Individual Account Cards */}
          {accounts.map((acc) => (
            <div
              key={acc.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedAccountId(acc.id === selectedAccountId ? null : acc.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedAccountId(acc.id === selectedAccountId ? null : acc.id); }}
              style={{
                flex: "0 0 auto",
                minWidth: 200,
                padding: "16px 20px",
                borderRadius: 14,
                border: `2px solid ${selectedAccountId === acc.id ? ACCOUNT_TYPE_COLORS[acc.accountType] || "#6366F1" : "var(--border-color)"}`,
                background: selectedAccountId === acc.id
                  ? `${ACCOUNT_TYPE_COLORS[acc.accountType] || "#6366F1"}12`
                  : "var(--bg-card)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s",
                position: "relative",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: `${ACCOUNT_TYPE_COLORS[acc.accountType] || "#6366F1"}20`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {acc.accountType === "cc" ? (
                    <CreditCard size={16} color={ACCOUNT_TYPE_COLORS[acc.accountType]} />
                  ) : (
                    <Landmark size={16} color={ACCOUNT_TYPE_COLORS[acc.accountType]} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    {acc.bankName || acc.name}
                  </div>
                  {acc.accountLast4 && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      ••••{acc.accountLast4}
                    </div>
                  )}
                </div>
                {/* Account type badge */}
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: `${ACCOUNT_TYPE_COLORS[acc.accountType] || "#94A3B8"}18`,
                    color: ACCOUNT_TYPE_COLORS[acc.accountType] || "#94A3B8",
                    textTransform: "uppercase",
                  }}
                >
                  {ACCOUNT_TYPE_LABELS[acc.accountType] || acc.accountType}
                </span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                {formatCurrency(Number(acc.currentBalance))}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 4,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {acc._count.transactions} txns
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingAccount(acc);
                      setShowAddModal(true);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 2,
                    }}
                    title="Edit"
                  >
                    <Edit3 size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAccount(acc.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 2,
                    }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Quick Add Card */}
          <button
            onClick={() => { setEditingAccount(null); setShowAddModal(true); }}
            style={{
              flex: "0 0 auto",
              minWidth: 140,
              padding: "16px 20px",
              borderRadius: 14,
              border: "2px dashed var(--border-color)",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--text-muted)",
              transition: "all 0.2s",
            }}
          >
            <Plus size={20} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>Add Account</span>
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      {!isEmpty && (
        <StaggerContainer className="kpi-grid" style={{ marginBottom: 24 }}>
          <SlideUp delay={0}>
          <div className="kpi-card">
            <div className="kpi-label">
              <Wallet size={14} /> Transactions
            </div>
            <div className="kpi-value">{summary.transactionCount}</div>
          </div>
          </SlideUp>
          <SlideUp delay={0.05}>
          <div className="kpi-card">
            <div className="kpi-label" style={{ color: "#22C55E" }}>
              <TrendingUp size={14} /> Total Credits
            </div>
            <div className="kpi-value" style={{ color: "#22C55E" }}>
              {formatCurrency(summary.totalCredit)}
            </div>
          </div>
          </SlideUp>
          <SlideUp delay={0.1}>
          <div className="kpi-card">
            <div className="kpi-label" style={{ color: "#F43F5E" }}>
              <TrendingDown size={14} /> Total Debits
            </div>
            <div className="kpi-value" style={{ color: "#F43F5E" }}>
              {formatCurrency(summary.totalDebit)}
            </div>
          </div>
          </SlideUp>
          <SlideUp delay={0.15}>
          <div className="kpi-card">
            <div className="kpi-label">
              <Sparkles size={14} /> Net Flow
            </div>
            <div
              className="kpi-value"
              style={{
                color:
                  summary.totalCredit - summary.totalDebit >= 0
                    ? "#22C55E"
                    : "#F43F5E",
              }}
            >
              {formatCurrency(summary.totalCredit - summary.totalDebit)}
            </div>
          </div>
          </SlideUp>
        </StaggerContainer>
      )}

      {/* Filters */}
      {!isEmpty && (
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <div style={{ position: "relative", flex: "1 1 240px" }}>
            <Search
              size={16}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-secondary)",
              }}
            />
            <input
              type="text"
              placeholder="Search transactions..."
              className="input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>
          <select
            className="input"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ flex: "0 0 160px" }}
          >
            <option value="">All Types</option>
            <option value="debit">Debits</option>
            <option value="credit">Credits</option>
          </select>
          <select
            className="input"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ flex: "0 0 200px" }}
          >
            <option value="">All Categories</option>
            {Object.keys(CATEGORY_COLORS).map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={16} />
            {uploading ? "Importing..." : "Import Statement"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {/* Empty State / Drop Zone */}
      {isEmpty && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "80px 40px",
            border: `2px dashed ${dragActive ? "var(--accent-primary)" : "var(--border-color)"}`,
            borderRadius: 16,
            background: dragActive
              ? "rgba(99, 102, 241, 0.05)"
              : "var(--bg-card)",
            transition: "all 0.2s ease",
            cursor: "pointer",
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #6366F1, #A855F7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FileSpreadsheet size={28} color="white" />
          </div>
          <h3 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>
            {accounts.length > 0
              ? `Import Statement for ${selectedAccountId ? accounts.find((a) => a.id === selectedAccountId)?.name || "Account" : "All Accounts"}`
              : "Add a Bank Account to Get Started"}
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--text-secondary)",
              maxWidth: 400,
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            {accounts.length > 0
              ? "Drag and drop a CSV or PDF bank statement here, or click to browse. Supports ICICI, HDFC, and other major bank formats."
              : "Click \"Add Account\" above to register your bank accounts, then import statements or connect Gmail for auto-import."}
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && !isEmpty && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
          <RefreshCw size={24} className="spin" style={{ marginBottom: 8 }} />
          <p>Loading transactions...</p>
        </div>
      )}

      {/* Transactions Table */}
      {!loading && !isEmpty && transactions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <DataTable
            columns={[
              {
                header: "Date",
                accessorKey: "date",
                cell: (row) => <div style={{ whiteSpace: "nowrap", fontSize: 13 }}>{formatDate(row.date)}</div>,
              },
              {
                header: "Description",
                accessorKey: "description",
                cell: (row) => (
                  <div>
                    <div
                      style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}
                      title={row.description}
                    >
                      {row.description}
                    </div>
                    {row.reference && (
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                        Ref: {row.reference}
                      </div>
                    )}
                  </div>
                ),
              },
              ...(!selectedAccountId ? [{
                header: "Account",
                accessorKey: "bankAccount.name",
                cell: (row: BankTransaction) => (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {row.bankAccount?.bankName || row.bankAccount?.name || "—"}
                  </div>
                ),
              }] : []),
              {
                header: "Category",
                accessorKey: "category",
                cell: (row) => row.category ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 10px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                      background: `${CATEGORY_COLORS[row.category] || "#9CA3AF"}18`,
                      color: CATEGORY_COLORS[row.category] || "#9CA3AF",
                      border: `1px solid ${CATEGORY_COLORS[row.category] || "#9CA3AF"}30`,
                    }}
                  >
                    {row.category}
                  </span>
                ) : null,
              },
              {
                header: "Vendor",
                accessorKey: "vendor",
                cell: (row) => (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.vendor || "—"}
                  </div>
                ),
              },
              {
                header: "Amount",
                accessorKey: "amount",
                cell: (row) => (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 4,
                      color: row.type === "credit" ? "#22C55E" : "#F43F5E",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {row.type === "credit" ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    {formatCurrency(Number(row.amount))}
                  </div>
                ),
              },
              {
                header: "Balance",
                accessorKey: "balance",
                cell: (row) => (
                  <div style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>
                    {row.balance != null ? formatCurrency(Number(row.balance)) : "—"}
                  </div>
                ),
              },
              {
                header: "Status",
                accessorKey: "isReconciled",
                cell: (row) => (
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {row.isReconciled ? (
                      <CheckCircle2 size={16} color="#22C55E" />
                    ) : (
                      <Circle size={16} color="var(--text-tertiary)" />
                    )}
                  </div>
                ),
              },
            ] as ColumnDef<BankTransaction>[]}
            data={transactions}
            searchPlaceholder="Search transactions..."
            searchFilter={(item, query) => 
              item.description.toLowerCase().includes(query.toLowerCase()) || 
              (item.vendor || "").toLowerCase().includes(query.toLowerCase())
            }
          />

          {/* Pagination handled server-side, DataTable displays current page, manual controls traverse boundary */}
          {pagination.totalPages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 0",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Showing {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} transactions
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchTransactions(pagination.page - 1)}
                  style={{ padding: "6px 12px" }}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => fetchTransactions(pagination.page + 1)}
                  style={{ padding: "6px 12px" }}
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No results for search/filter */}
      {!loading && !isEmpty && transactions.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: 60,
            color: "var(--text-secondary)",
          }}
        >
          <AlertCircle
            size={40}
            style={{ marginBottom: 12, opacity: 0.5 }}
          />
          <p>No transactions match your filters</p>
        </div>
      )}

      {/* Add / Edit Account Modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => { setShowAddModal(false); setEditingAccount(null); }}
          onSave={() => {
            setShowAddModal(false);
            setEditingAccount(null);
            fetchAccounts();
          }}
          editAccount={editingAccount}
          toast={toast}
        />
      )}

      {/* Spinner animation */}
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
      {confirmDialog}
    </div>
  );
}
