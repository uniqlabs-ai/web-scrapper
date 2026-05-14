"use client";

import { useState, useEffect } from "react";
import { BookOpen } from "lucide-react";
import { useToast } from "@/components/toast";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTable, ColumnDef } from "@/components/data-table";

interface Account {
  code: string; name: string; type: string; subtype: string; balance: number;
}

interface BalanceSheet {
  assets: { current: Account[]; fixed: Account[]; total: number };
  liabilities: { current: Account[]; nonCurrent: Account[]; total: number };
  equity: { items: Account[]; total: number };
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

const TYPE_COLORS: Record<string, string> = {
  asset: "#22C55E", liability: "#EF4444", equity: "#6366F1", revenue: "#F59E0B", expense: "#EC4899",
};

export default function AccountingPage() {

  const [view, setView] = useState<"chart" | "balance-sheet" | "trial-balance" | "journal">("chart");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [trialBalance, setTrialBalance] = useState<{ accounts: { code: string; name: string; type: string; debit: number; credit: number }[]; totalDebits: number; totalCredits: number; isBalanced: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      if (view === "balance-sheet") {
        const res = await fetch("/api/accounting/chart?view=balance-sheet");
        const data = await res.json();
        setBs(data.balanceSheet);
      } else if (view === "trial-balance") {
        const res = await fetch("/api/accounting/trial-balance");
        const data = await res.json();
        setTrialBalance({
          accounts: data.trialBalance || [],
          totalDebits: data.totals?.debits || 0,
          totalCredits: data.totals?.credits || 0,
          isBalanced: data.totals?.isBalanced ?? true,
        });
      } else {
        const res = await fetch("/api/accounting/chart");
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [view]);

  const grouped = accounts.reduce((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {} as Record<string, Account[]>);

  return (
    <div>
      <PageHeader title="Accounting" description="Chart of Accounts, Journal Entries & Balance Sheet" />

      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-secondary)", padding: 4, borderRadius: 8, width: "fit-content" }}>
        {(["chart", "balance-sheet", "trial-balance", "journal"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: "8px 20px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: view === v ? "var(--bg-card)" : "transparent",
            color: view === v ? "var(--text-primary)" : "var(--text-secondary)",
            boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
          }}>
            {v === "chart" ? "Chart of Accounts" : v === "balance-sheet" ? "Balance Sheet" : v === "trial-balance" ? "Trial Balance" : "Journal"}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Loading...</div>
      ) : view === "chart" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {Object.entries(grouped).map(([type, accts]) => (
            <div key={type} className="table-container">
              <div className="table-header" style={{ display: "flex", justifyContent: "space-between" }}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: TYPE_COLORS[type] || "#666", display: "inline-block" }} />
                  {type.charAt(0).toUpperCase() + type.slice(1)}s ({accts.length})
                </h3>
              </div>
              <DataTable
                columns={[
                  {
                    header: "Code",
                    accessorKey: "code",
                    cell: (row) => <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: TYPE_COLORS[type] }}>{row.code}</span>,
                  },
                  {
                    header: "Account Name",
                    accessorKey: "name",
                    cell: (row) => <span style={{ fontWeight: 500 }}>{row.name}</span>,
                  },
                  {
                    header: "Subtype",
                    accessorKey: "subtype",
                    cell: (row) => <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "rgba(255,255,255,0.04)" }}>{row.subtype}</span>,
                  },
                ] as ColumnDef<Account>[]}
                data={accts}
              />
            </div>
          ))}
        </div>
      ) : view === "balance-sheet" && bs ? (
        <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Assets */}
          <div className="table-container" style={{ padding: 24 }}>
            <h3 style={{ color: "#22C55E", marginBottom: 16 }}>Assets</h3>
            <h4 style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>CURRENT ASSETS</h4>
            {bs.assets.current.map((a) => (
              <div key={a.code} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span>{a.name}</span><span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
              </div>
            ))}
            <h4 style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 16, marginBottom: 8 }}>FIXED ASSETS</h4>
            {bs.assets.fixed.map((a) => (
              <div key={a.code} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span>{a.name}</span><span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", marginTop: 12, borderTop: "2px solid var(--border-color)", fontSize: 16, fontWeight: 800 }}>
              <span>Total Assets</span><span style={{ color: "#22C55E" }}>{fmt(bs.assets.total)}</span>
            </div>
          </div>

          {/* Liabilities & Equity */}
          <div className="table-container" style={{ padding: 24 }}>
            <h3 style={{ color: "#EF4444", marginBottom: 16 }}>Liabilities & Equity</h3>
            <h4 style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>CURRENT LIABILITIES</h4>
            {bs.liabilities.current.map((a) => (
              <div key={a.code} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span>{a.name}</span><span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
              </div>
            ))}
            <h4 style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 16, marginBottom: 8 }}>EQUITY</h4>
            {bs.equity.items.map((a) => (
              <div key={a.code} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span>{a.name}</span><span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", marginTop: 12, borderTop: "2px solid var(--border-color)", fontSize: 16, fontWeight: 800 }}>
              <span>Total L&E</span><span style={{ color: "#6366F1" }}>{fmt(bs.totalLiabilitiesAndEquity)}</span>
            </div>
            <div style={{ marginTop: 8, textAlign: "center" }}>
              <span style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: bs.isBalanced ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: bs.isBalanced ? "#22C55E" : "#EF4444" }}>
                {bs.isBalanced ? "✓ BALANCED" : "✗ UNBALANCED"}
              </span>
            </div>
          </div>
        </div>
      ) : view === "trial-balance" && trialBalance ? (
        <div className="table-container">
          <div className="table-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Trial Balance</h3>
            <span style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: trialBalance.isBalanced ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: trialBalance.isBalanced ? "#22C55E" : "#EF4444" }}>
              {trialBalance.isBalanced ? "✓ BALANCED" : "✗ UNBALANCED"}
            </span>
          </div>
          <DataTable
            columns={[
              {
                header: "Code",
                accessorKey: "code",
                cell: (row) => <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: TYPE_COLORS[row.type] || "#666" }}>{row.code}</span>,
              },
              {
                header: "Account",
                accessorKey: "name",
                cell: (row) => <span style={{ fontWeight: 500 }}>{row.name}</span>,
              },
              {
                header: "Type",
                accessorKey: "type",
                cell: (row) => <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, background: `${TYPE_COLORS[row.type] || "#666"}15`, color: TYPE_COLORS[row.type] || "#666" }}>{row.type}</span>,
              },
              {
                header: "Debit",
                accessorKey: "debit",
                align: "right",
                cell: (row) => <span style={{ fontWeight: (row.debit as number) > 0 ? 600 : 400, color: (row.debit as number) > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }}>{(row.debit as number) > 0 ? fmt(row.debit as number) : "—"}</span>,
              },
              {
                header: "Credit",
                accessorKey: "credit",
                align: "right",
                cell: (row) => <span style={{ fontWeight: (row.credit as number) > 0 ? 600 : 400, color: (row.credit as number) > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }}>{(row.credit as number) > 0 ? fmt(row.credit as number) : "—"}</span>,
              },
            ] as ColumnDef<{ code: string; name: string; type: string; debit: number; credit: number }>[]}
            data={trialBalance.accounts}
          />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px", background: "var(--bg-secondary)", borderTop: "2px solid var(--border-color)", fontWeight: 800, fontSize: 14 }}>
            <span>TOTAL</span>
            <div style={{ display: "flex", gap: 32 }}>
              <span style={{ minWidth: 100, textAlign: "right" }}>{fmt(trialBalance.totalDebits)}</span>
              <span style={{ minWidth: 100, textAlign: "right" }}>{fmt(trialBalance.totalCredits)}</span>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="Journal Entries"
          description="Record double-entry journal transactions via the API"
        />
      )}
    </div>
  );
}
