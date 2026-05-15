"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import {
  GitMerge,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Link2,
  Eye,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface Suggestion {
  type: string;
  id: string;
  description: string;
  amount: number;
  date: string;
  confidence: number;
}

interface UnmatchedTxn {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  category: string | null;
  suggestions: Suggestion[];
  bestMatch: Suggestion | null;
}

interface PendingMatch {
  transactionId: string;
  transactionDesc: string;
  transactionAmount: number;
  transactionDate: string;
  transactionType: string;
  matchType: string;
  matchId: string;
  matchDesc: string;
  matchAmount: number;
  matchDate: string;
  confidence: number;
  suggestedCategory: string | null;
}

interface Summary {
  totalUnmatched: number;
  withSuggestions: number;
  autoMatchable: number;
}

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

const confColor = (c: number) =>
  c >= 0.9 ? "#22C55E" : c >= 0.7 ? "#F59E0B" : "#6B7280";

const confBg = (c: number) =>
  c >= 0.9 ? "rgba(34,197,94,0.12)" : c >= 0.7 ? "rgba(245,158,11,0.12)" : "rgba(107,114,128,0.08)";

export default function ReconciliationPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<UnmatchedTxn[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalUnmatched: 0, withSuggestions: 0, autoMatchable: 0 });
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [dateRange, setDateRange] = useState({ from: "", to: "", label: "All Time" });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.from) params.set("from", dateRange.from);
      if (dateRange.to) params.set("to", dateRange.to);
      const qs = params.toString();
      const res = await fetch(`/api/reconciliation${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      setItems(data.unmatched || []);
      setSummary(data.summary || { totalUnmatched: 0, withSuggestions: 0, autoMatchable: 0 });
    } catch (err) {
      clientLog.error("Failed to load unmatched transactions", "reconciliation", "load", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [dateRange]);

  async function confirmMatch(txnId: string, matchType: string, matchId: string, category?: string | null) {
    try {
      await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: txnId, matchType, matchId, category }),
      });
      toast("Transaction reconciled", "success");
      setItems((prev) => prev.filter((i) => i.id !== txnId));
      setSummary((prev) => ({ ...prev, totalUnmatched: prev.totalUnmatched - 1 }));
    } catch (err) {
      clientLog.error("Failed to confirm match", "reconciliation", "match", err);
      toast("Failed to reconcile", "error");
    }
  }

  async function dismissTxn(txnId: string) {
    try {
      await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: txnId }),
      });
      toast("Marked as reconciled", "success");
      setItems((prev) => prev.filter((i) => i.id !== txnId));
      setSummary((prev) => ({ ...prev, totalUnmatched: prev.totalUnmatched - 1 }));
    } catch (err) {
      clientLog.error("Failed to dismiss transaction", "reconciliation", "dismiss", err);
    }
  }

  async function autoMatchAll() {
    const autoItems = items.filter((i) => i.bestMatch && i.bestMatch.confidence >= 0.9);
    let matched = 0;
    for (const item of autoItems) {
      try {
        await fetch("/api/reconciliation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: item.id,
            matchType: item.bestMatch!.type,
            matchId: item.bestMatch!.id,
          }),
        });
        matched++;
      } catch { /* skip */ }
    }
    toast(`${matched} transactions auto-reconciled`, "success");
    load();
  }

  async function runAutoReconcile() {
    setReconciling(true);
    try {
      const res = await fetch("/api/reconciliation/auto", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        if (data.pendingReview && data.pendingReview.length > 0) {
          setPendingMatches(data.pendingReview);
          setShowReview(true);
          toast(`${data.pendingReview.length} matches ready for review`, "success");
        } else {
          toast("No matches found", "info");
        }
      } else {
        toast(data.error || "Auto-reconciliation failed", "error");
      }
    } catch {
      toast("Auto-reconciliation failed", "error");
    }
    setReconciling(false);
  }

  async function confirmPendingMatch(match: PendingMatch) {
    try {
      await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: match.transactionId,
          matchType: match.matchType,
          matchId: match.matchId,
          category: match.suggestedCategory,
        }),
      });
      setPendingMatches((prev) => prev.filter((m) => m.transactionId !== match.transactionId));
      toast("Match confirmed", "success");
    } catch {
      toast("Failed to confirm match", "error");
    }
  }

  async function rejectPendingMatch(txnId: string) {
    setPendingMatches((prev) => prev.filter((m) => m.transactionId !== txnId));
    toast("Match rejected", "info");
  }

  async function confirmAllPending() {
    setConfirmingAll(true);
    let confirmed = 0;
    for (const match of pendingMatches) {
      try {
        await fetch("/api/reconciliation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: match.transactionId,
            matchType: match.matchType,
            matchId: match.matchId,
            category: match.suggestedCategory,
          }),
        });
        confirmed++;
      } catch { /* skip */ }
    }
    setPendingMatches([]);
    setShowReview(false);
    setConfirmingAll(false);
    toast(`${confirmed} matches confirmed`, "success");
    load();
  }

  return (
    <div>
      <PageHeader title="Reconciliation" description="Match bank transactions to expenses, invoices, and revenue">
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={runAutoReconcile} disabled={reconciling}>
            <RefreshCw size={16} className={reconciling ? "spin" : ""} /> {reconciling ? "Analyzing..." : "AI Auto-Reconcile"}
          </button>
          <button className="btn btn-secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
          {summary.autoMatchable > 0 && (
            <button className="btn btn-primary" onClick={autoMatchAll}>
              <Link2 size={16} /> Auto-Match {summary.autoMatchable}
            </button>
          )}
        </div>
      </PageHeader>

      <DateRangeFilter onChange={setDateRange} />

      {/* Progress Bar */}
      {(() => {
        const total = summary.totalUnmatched + summary.autoMatchable;
        const matchedPct = total > 0 ? Math.round(((total - summary.totalUnmatched + summary.autoMatchable) / Math.max(total, 1)) * 100) : 100;
        const timeSaved = Math.round(summary.autoMatchable * 2.5); // ~2.5 min per manual match
        return total > 0 ? (
          <div style={{
            padding: "14px 18px", marginBottom: 16, borderRadius: 12,
            background: "var(--bg-card)", border: "1px solid var(--border-color)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Reconciliation Progress</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {summary.autoMatchable > 0 && `⏱ ~${timeSaved} min estimated savings`}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                width: `${matchedPct}%`,
                background: "linear-gradient(90deg, #6366F1, #22C55E)",
                transition: "width 0.5s ease",
              }} />
            </div>
          </div>
        ) : null;
      })()}

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card" style={{ borderColor: summary.totalUnmatched > 0 ? "rgba(234,179,8,0.3)" : "rgba(34,197,94,0.2)" }}>
          <div className="kpi-label">Unmatched</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{summary.totalUnmatched}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">With Suggestions</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{summary.withSuggestions}</div>
        </div>
        <div className="kpi-card" style={{ borderColor: "rgba(99,102,241,0.2)" }}>
          <div className="kpi-label">Auto-Matchable (90%+)</div>
          <div className="kpi-value" style={{ fontSize: 28, color: "#6366F1" }}>{summary.autoMatchable}</div>
        </div>
        <div className="kpi-card" style={{ borderColor: "rgba(34,197,94,0.2)" }}>
          <div className="kpi-label">Match Rate</div>
          <div className="kpi-value" style={{ fontSize: 28, color: summary.totalUnmatched === 0 ? "#22C55E" : "var(--text-primary)" }}>
            {summary.totalUnmatched === 0 ? "100%" : `${summary.withSuggestions > 0 ? Math.round((summary.withSuggestions / summary.totalUnmatched) * 100) : 0}%`}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>suggestions found</div>
        </div>
      </div>

      {/* ========== REVIEW PANEL ========== */}
      {showReview && pendingMatches.length > 0 && (
        <div style={{
          marginBottom: 24, padding: 20, background: "var(--bg-card)",
          borderRadius: 16, border: "2px solid rgba(139,92,246,0.3)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Eye size={20} style={{ color: "var(--accent-purple)" }} />
              <h3 style={{ margin: 0 }}>Review Proposed Matches ({pendingMatches.length})</h3>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={confirmAllPending}
                disabled={confirmingAll}
                style={{ fontSize: 13 }}
              >
                <ThumbsUp size={14} /> {confirmingAll ? "Confirming..." : `Confirm All (${pendingMatches.length})`}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setPendingMatches([]); setShowReview(false); }}
                style={{ fontSize: 13 }}
              >
                <X size={14} /> Cancel
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingMatches.map((match) => (
              <div
                key={match.transactionId}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "12px 16px", borderRadius: 10,
                  background: confBg(match.confidence),
                  border: `1px solid ${confColor(match.confidence)}20`,
                }}
              >
                {/* Transaction */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{match.transactionDesc}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                    {new Date(match.transactionDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    {" · "}
                    <span style={{
                      padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700,
                      background: match.transactionType === "credit" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                      color: match.transactionType === "credit" ? "#22C55E" : "#F43F5E",
                    }}>
                      {match.transactionType === "credit" ? "IN" : "OUT"}
                    </span>
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, minWidth: 100, textAlign: "right" }}>
                  {fmt(match.transactionAmount)}
                </div>

                {/* Arrow */}
                <ArrowRight size={16} style={{ color: confColor(match.confidence), flexShrink: 0 }} />

                {/* Match */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{match.matchDesc}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{
                      padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700,
                      background: "rgba(99,102,241,0.15)", color: "#6366F1",
                    }}>
                      {match.matchType.toUpperCase()}
                    </span>
                    {match.suggestedCategory && (
                      <span style={{
                        padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600,
                        background: "rgba(139,92,246,0.12)", color: "var(--accent-purple)",
                      }}>
                        {match.suggestedCategory}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, minWidth: 100, textAlign: "right" }}>
                  {fmt(match.matchAmount)}
                </div>

                {/* Confidence */}
                <span style={{
                  padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: confBg(match.confidence),
                  color: confColor(match.confidence),
                  minWidth: 40, textAlign: "center",
                }}>
                  {Math.round(match.confidence * 100)}%
                </span>

                {/* Actions */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => confirmPendingMatch(match)}
                    title="Accept match"
                    style={{
                      padding: "6px 10px", borderRadius: 6, border: "none",
                      background: "rgba(34,197,94,0.15)", color: "#22C55E",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12,
                    }}
                  >
                    <Check size={12} /> Accept
                  </button>
                  <button
                    onClick={() => rejectPendingMatch(match.transactionId)}
                    title="Reject match"
                    style={{
                      padding: "6px 10px", borderRadius: 6, border: "none",
                      background: "rgba(239,68,68,0.1)", color: "#F43F5E",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12,
                    }}
                  >
                    <ThumbsDown size={12} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>Loading transactions...</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All Reconciled!"
          description="All bank transactions have been matched. Import more transactions to continue."
          action={
            <a href="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Import Statement
            </a>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((txn) => (
            <div
              key={txn.id}
              style={{
                padding: 20, background: "var(--bg-card)", borderRadius: 12,
                border: `1px solid ${txn.bestMatch ? "rgba(99,102,241,0.2)" : "var(--border-color)"}`,
              }}
            >
              {/* Transaction Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      background: txn.type === "credit" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                      color: txn.type === "credit" ? "#22C55E" : "#F43F5E",
                    }}>
                      {txn.type === "credit" ? "IN" : "OUT"}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{txn.description}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 12, color: "var(--text-secondary)" }}>
                    <span>{new Date(txn.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                    {txn.category && <span>• {txn.category}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{fmt(txn.amount)}</div>
                </div>
              </div>

              {/* Match Suggestions */}
              {txn.suggestions.length > 0 ? (
                <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Suggested Matches
                  </p>
                  {txn.suggestions.map((match, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 12px", borderRadius: 8, marginBottom: 4,
                        background: match.confidence >= 0.9 ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                        <ArrowRight size={12} style={{ color: "var(--text-tertiary)" }} />
                        <span style={{ fontSize: 13 }}>{match.description}</span>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {fmt(match.amount)}
                        </span>
                        <span style={{
                          padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: confBg(match.confidence),
                          color: confColor(match.confidence),
                        }}>
                          {Math.round(match.confidence * 100)}%
                        </span>
                      </div>
                      <button
                        onClick={() => confirmMatch(txn.id, match.type, match.id)}
                        className="btn btn-primary"
                        style={{ padding: "4px 12px", fontSize: 12 }}
                      >
                        <Check size={12} /> Match
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertCircle size={12} /> No matches found
                  </span>
                  <button
                    onClick={() => dismissTxn(txn.id)}
                    style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <X size={12} /> Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
