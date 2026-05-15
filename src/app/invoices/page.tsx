"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Send,
  CheckCircle,
  X,
  Eye,
  FileText,
  Download,
  Mail,
  Loader2,
  CreditCard,
  Zap,
  ArrowRight,
  Check,
  Clock,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { SkeletonTable } from "@/components/skeleton";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/page-header";
import { DataTable, ColumnDef } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";

import { TablePageSkeleton } from "@/components/page-skeleton";
import { AccessibleModal } from "@/components/accessible-modal";
import { StaggerContainer, SlideUp } from "@/components/animations";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
}

interface Client {
  id: string;
  name: string;
  company?: string;
  email?: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  currency?: string;
  client?: { name: string; company?: string; email?: string };
  lineItems: { description: string; quantity: string; unitPrice: string; total: string }[];
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<TablePageSkeleton />}>
      <InvoicesContent />
    </Suspense>
  );
}

function InvoicesContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, gstRate: 18 },
  ]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isInterState, setIsInterState] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [dateRange, setDateRange] = useState({ from: "", to: "", label: "All Time" });
  const [showPipeline, setShowPipeline] = useState(false);

  // Follow-up pipeline state
  interface PipelineItem {
    invoiceId: string; invoiceNumber: string; clientName: string; clientEmail: string | null;
    total: number; currency: string; dueDate: string; daysPastDue: number;
    currentStage: number; sentReminders: { sequence: number; sentAt: string }[];
    nextSequence: number | null; nextReminderDate: string | null; isFullyEscalated: boolean;
  }
  interface PipelineStats {
    totalOverdue: number; overdueCount: number; remindersSentThisWeek: number;
    sequences: number[];
  }
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);

  // Auto-match state
  interface AutoMatchSuggestion {
    invoiceId: string;
    invoiceNumber: string;
    invoiceTotal: number;
    clientName: string;
    transactionId: string;
    transactionDesc: string;
    transactionAmount: number;
    transactionDate: string;
    confidence: number;
    matchReason: string;
  }
  const [autoMatches, setAutoMatches] = useState<AutoMatchSuggestion[]>([]);


  const recordPayment = async (invoiceId: string) => {
    if (!paymentAmount || Number(paymentAmount) <= 0) return;
    await fetch(`/api/invoices/${invoiceId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(paymentAmount), method: "bank_transfer" }),
    });
    setPaymentAmount("");
    setShowPayment(false);
    setSelectedInvoice(null);
    loadInvoices();
    toast("Payment recorded", "success");
  };

  useEffect(() => {
    loadInvoices();
    fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.clients || [])).catch(() => { });
    loadAutoMatches();
    loadPipeline();
  }, [dateRange]);

  const loadPipeline = () => {
    fetch("/api/invoices/remind")
      .then((r) => r.json())
      .then((d) => { setPipeline(d.pipeline || []); setPipelineStats(d.stats || null); })
      .catch(() => {});
  };

  useEffect(() => {
    if (searchParams?.get("new") === "1") {
      setShowCreate(true);
      window.history.replaceState(null, "", "/invoices");
    }
  }, [searchParams]);

  const loadAutoMatches = () => {
    fetch("/api/invoices/auto-match")
      .then((r) => r.json())
      .then((d) => setAutoMatches(d.suggestions || []))
      .catch(() => {});
  };

  const loadInvoices = () => {
    const params = new URLSearchParams();
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    const qs = params.toString();
    fetch(`/api/invoices${qs ? `?${qs}` : ""}`)
      .then((res) => res.json())
      .then((d) => { setInvoices(d.invoices || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const createInvoice = async () => {
    if (!dueDate || lineItems.some((li) => !li.description || li.unitPrice <= 0)) {
      toast("Please fill in due date and all line item details", "error");
      return;
    }
    await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate, notes, isInterState, lineItems, clientId: clientId || undefined }),
    });
    setShowCreate(false);
    setLineItems([{ description: "", quantity: 1, unitPrice: 0, gstRate: 18 }]);
    setDueDate("");
    setNotes("");
    setClientId("");
    loadInvoices();
    toast("Invoice created", "success");
  };

  const sendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch("/api/invoices/remind", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast(`Processed ${data.total} overdue invoices, sent ${data.sent} reminders`, "success");
        loadInvoices();
      } else {
        toast(data.error || "Failed to send reminders", "error");
      }
    } catch {
      toast("Failed to send reminders", "error");
    }
    setSendingReminders(false);
  };

  const performAction = async (id: string, action: string) => {
    await fetch(`/api/invoices/${id}/${action}`, { method: "POST" });
    loadInvoices();
    setSelectedInvoice(null);
    toast(
      action === "send" ? "Invoice marked as sent" : "Invoice marked as paid",
      "success"
    );
  };

  const downloadPDF = (id: string, invoiceNumber: string) => {
    const link = document.createElement("a");
    link.href = `/api/invoices/${id}/pdf`;
    link.download = `${invoiceNumber}.pdf`;
    link.click();
    toast("Downloading PDF...", "info");
  };

  const emailInvoice = async (id: string) => {
    setSendingEmail(id);
    try {
      const res = await fetch(`/api/invoices/${id}/email`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || "Invoice emailed", "success");
        loadInvoices();
      } else {
        toast(data.error || "Failed to send email", "error");
      }
    } catch {
      toast("Failed to send email", "error");
    }
    setSendingEmail(null);
  };

  const CURRENCY_LOCALE: Record<string, string> = { INR: "en-IN", USD: "en-US", EUR: "de-DE", GBP: "en-GB" };
  const formatCurrency = (n: number | string, curr = "INR") => {
    const code = curr || "INR";
    const locale = CURRENCY_LOCALE[code] || "en-US";
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(Number(n));
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unitPrice: 0, gstRate: 18 }]);
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Summary KPIs — group by currency
  const kpiOutstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce<Record<string, number>>((acc, i) => {
      const c = i.currency || "INR";
      acc[c] = (acc[c] || 0) + Number(i.total);
      return acc;
    }, {});
  const kpiPaid = invoices
    .filter((i) => i.status === "paid")
    .reduce<Record<string, number>>((acc, i) => {
      const c = i.currency || "INR";
      acc[c] = (acc[c] || 0) + Number(i.total);
      return acc;
    }, {});
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;
  const formatKpi = (map: Record<string, number>) => {
    const entries = Object.entries(map).filter(([, v]) => v > 0);
    if (entries.length === 0) return formatCurrency(0);
    return entries.map(([c, v]) => formatCurrency(v, c)).join(" + ");
  };

  const invoiceColumns: ColumnDef<Invoice>[] = [
    {
      header: "Invoice",
      accessorKey: "invoiceNumber",
      cell: (inv) => <span style={{ fontWeight: 600 }}>{inv.invoiceNumber}</span>,
    },
    {
      header: "Client",
      cell: (inv) => inv.client?.name || "—",
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (inv) => <span className={`badge ${inv.status}`}>{inv.status}</span>,
    },
    {
      header: "Date",
      accessorKey: "issueDate",
      cell: (inv) => <span style={{ color: "var(--text-secondary)" }}>{new Date(inv.issueDate).toLocaleDateString("en-IN")}</span>,
    },
    {
      header: "Due",
      accessorKey: "dueDate",
      cell: (inv) => <span style={{ color: "var(--text-secondary)" }}>{new Date(inv.dueDate).toLocaleDateString("en-IN")}</span>,
    },
    {
      header: "Amount",
      accessorKey: "total",
      cell: (inv) => <span style={{ fontWeight: 700 }}>{formatCurrency(inv.total, inv.currency)}</span>,
      align: "right",
    },
    {
      header: "Actions",
      sortable: false,
      align: "right",
      cell: (inv) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); }} title="View">
            <Eye size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); downloadPDF(inv.id, inv.invoiceNumber); }} title="Download PDF">
            <Download size={14} />
          </button>
          {inv.client?.email && inv.status !== "paid" && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); emailInvoice(inv.id); }}
              disabled={sendingEmail === inv.id}
              title="Email Invoice"
            >
              {sendingEmail === inv.id ? <Loader2 size={14} className="loading" /> : <Mail size={14} />}
            </button>
          )}
          {inv.status === "draft" && (
            <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); performAction(inv.id, "send"); }}>
              <Send size={14} /> Send
            </button>
          )}
          {(inv.status === "sent" || inv.status === "overdue") && (
            <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); performAction(inv.id, "paid"); }}>
              <CheckCircle size={14} /> Paid
            </button>
          )}
        </div>
      ),
    },
  ];

  const searchFilter = (inv: Invoice, q: string) => 
    inv.invoiceNumber.toLowerCase().includes(q.toLowerCase()) || 
    (inv.client?.name || "").toLowerCase().includes(q.toLowerCase());

  return (
    <div>
      <PageHeader title="Invoices" description="Create, send, and track your invoices">
        {overdueCount > 0 && (
          <button className="btn btn-secondary" onClick={sendReminders} disabled={sendingReminders}>
            <Mail size={16} /> {sendingReminders ? "Sending..." : `Remind ${overdueCount} Overdue`}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Invoice
        </button>
      </PageHeader>

      <DateRangeFilter onChange={setDateRange} />

      {/* Summary KPIs */}
      <StaggerContainer className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <SlideUp delay={0}>
        <div className="kpi-card amber">
          <div className="kpi-label">Outstanding</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKpi(kpiOutstanding)}</div>
        </div>
        </SlideUp>
        <SlideUp delay={0.05}>
        <div className="kpi-card green">
          <div className="kpi-label">Collected</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKpi(kpiPaid)}</div>
        </div>
        </SlideUp>
        <SlideUp delay={0.1}>
        <div className="kpi-card red">
          <div className="kpi-label">Overdue</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{overdueCount}</div>
        </div>
        </SlideUp>
        <SlideUp delay={0.15}>
        <div className="kpi-card purple">
          <div className="kpi-label">Total Invoices</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{invoices.length}</div>
        </div>
        </SlideUp>
      </StaggerContainer>

      {/* Follow-Up Pipeline */}
      {pipeline.length > 0 && (
        <div style={{
          background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
          border: "1px solid rgba(99, 102, 241, 0.25)", padding: 20, marginBottom: 24,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Clock size={16} color="#fff" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Follow-Up Pipeline</h3>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                  {pipelineStats?.overdueCount} overdue · {formatCurrency(pipelineStats?.totalOverdue || 0)} outstanding · {pipelineStats?.remindersSentThisWeek || 0} reminders this week
                </p>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowPipeline(!showPipeline)}
              style={{ fontSize: 12 }}
            >
              {showPipeline ? "Collapse" : "Expand"}
            </button>
          </div>

          {/* Stage summary bar */}
          {pipelineStats && (
            <div className="responsive-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${pipelineStats.sequences.length}, 1fr)`, gap: 8, marginBottom: showPipeline ? 16 : 0 }}>
              {pipelineStats.sequences.map((seq) => {
                const count = pipeline.filter((p) => p.currentStage === seq).length;
                const total = pipeline.filter((p) => p.currentStage === seq).reduce((s, p) => s + p.total, 0);
                return (
                  <div key={seq} style={{
                    padding: "10px 14px", borderRadius: 10, textAlign: "center",
                    background: count > 0 ? `rgba(99, 102, 241, ${0.05 + (seq / 30) * 0.15})` : "var(--bg-input)",
                    border: `1px solid ${count > 0 ? `rgba(99, 102, 241, ${0.15 + (seq / 30) * 0.2})` : "var(--border-color)"}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Day {seq}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: count > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>{count}</div>
                    {count > 0 && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{formatCurrency(total)}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Expanded detail */}
          {showPipeline && pipeline.map((item) => (
            <div key={item.invoiceId} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", borderRadius: 10, marginBottom: 6,
              background: item.isFullyEscalated ? "rgba(239, 68, 68, 0.06)" : "rgba(99, 102, 241, 0.04)",
              border: `1px solid ${item.isFullyEscalated ? "rgba(239, 68, 68, 0.15)" : "rgba(99, 102, 241, 0.1)"}`,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {item.invoiceNumber} · {item.clientName}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> — {formatCurrency(item.total, item.currency)}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 12 }}>
                  <span>{item.daysPastDue}d overdue</span>
                  <span>{item.sentReminders.length} reminder{item.sentReminders.length !== 1 ? "s" : ""} sent</span>
                  {item.nextReminderDate && (
                    <span style={{ color: "var(--accent-purple)" }}>
                      Next: Day {item.nextSequence}
                    </span>
                  )}
                </div>
              </div>
              {/* Stage dots */}
              <div style={{ display: "flex", gap: 4 }}>
                {pipelineStats?.sequences.map((seq) => {
                  const sent = item.sentReminders.some((r) => r.sequence === seq);
                  const pending = !sent && item.daysPastDue >= seq;
                  return (
                    <div key={seq} style={{
                      width: 20, height: 20, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: sent ? "rgba(34, 197, 94, 0.2)" : pending ? "rgba(245, 158, 11, 0.2)" : "var(--bg-input)",
                      border: `1px solid ${sent ? "rgba(34, 197, 94, 0.4)" : pending ? "rgba(245, 158, 11, 0.4)" : "var(--border-color)"}`,
                    }}
                      title={sent ? `Day ${seq}: Sent` : pending ? `Day ${seq}: Pending` : `Day ${seq}: Scheduled`}
                    >
                      {sent ? <Check size={10} color="#22C55E" /> : pending ? <AlertCircle size={10} color="#F59E0B" /> : null}
                    </div>
                  );
                })}
              </div>
              {item.isFullyEscalated && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "2px 8px", borderRadius: 6 }}>ESCALATED</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Auto-Match Bank Payments */}
      {autoMatches.length > 0 && (
        <div style={{
          background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
          border: "1px solid rgba(34, 197, 94, 0.25)", padding: 20, marginBottom: 24,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #22C55E, #10B981)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Zap size={16} color="#fff" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Bank Payment Matches Found</h3>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                {autoMatches.length} invoice{autoMatches.length !== 1 ? "s" : ""} may have been paid — review and confirm
              </p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {autoMatches.map((match) => (
              <div
                key={match.invoiceId}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderRadius: 10,
                  background: match.confidence >= 0.9 ? "rgba(34,197,94,0.06)" : "rgba(245,158,11,0.06)",
                  border: `1px solid ${match.confidence >= 0.9 ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)"}`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {match.invoiceNumber} · {match.clientName}
                    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> — {formatCurrency(match.invoiceTotal)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {match.matchReason}
                  </div>
                </div>
                <ArrowRight size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <div style={{ minWidth: 180, textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{formatCurrency(match.transactionAmount)}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {new Date(match.transactionDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    {" · "}{match.transactionDesc.slice(0, 40)}{match.transactionDesc.length > 40 ? "..." : ""}
                  </div>
                </div>
                <span style={{
                  padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: match.confidence >= 0.9 ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
                  color: match.confidence >= 0.9 ? "#22C55E" : "#F59E0B",
                  minWidth: 40, textAlign: "center",
                }}>
                  {Math.round(match.confidence * 100)}%
                </span>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={async () => {
                      await fetch("/api/invoices/auto-match", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ invoiceId: match.invoiceId, transactionId: match.transactionId }),
                      });
                      toast(`${match.invoiceNumber} marked as paid`, "success");
                      setAutoMatches((prev) => prev.filter((m) => m.invoiceId !== match.invoiceId));
                      loadInvoices();
                    }}
                    style={{
                      padding: "5px 10px", borderRadius: 6, border: "none",
                      background: "rgba(34,197,94,0.15)", color: "#22C55E",
                      cursor: "pointer", fontSize: 12, fontWeight: 600,
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    <Check size={12} /> Accept
                  </button>
                  <button
                    onClick={() => setAutoMatches((prev) => prev.filter((m) => m.invoiceId !== match.invoiceId))}
                    style={{
                      padding: "5px 10px", borderRadius: 6, border: "none",
                      background: "rgba(255,255,255,0.05)", color: "var(--text-muted)",
                      cursor: "pointer", fontSize: 12,
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aging Dashboard */}
      {(() => {
        const now = new Date();
        const unpaid = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
        const buckets = [
          { label: "Current", min: -Infinity, max: 0, color: "#22C55E", items: [] as Invoice[] },
          { label: "1–30 days", min: 1, max: 30, color: "#F59E0B", items: [] as Invoice[] },
          { label: "31–60 days", min: 31, max: 60, color: "#F97316", items: [] as Invoice[] },
          { label: "61–90 days", min: 61, max: 90, color: "#EF4444", items: [] as Invoice[] },
          { label: "90+ days", min: 91, max: Infinity, color: "#DC2626", items: [] as Invoice[] },
        ];
        unpaid.forEach((inv) => {
          const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
          const bucket = buckets.find((b) => daysOverdue >= b.min && daysOverdue <= b.max);
          if (bucket) bucket.items.push(inv);
        });
        const bucketTotals = buckets.map((b) => ({
          ...b,
          total: b.items.reduce((sum, inv) => sum + Number(inv.total), 0),
          count: b.items.length,
        }));
        const grandTotal = bucketTotals.reduce((s, b) => s + b.total, 0);
        // DSO = (Accounts Receivable / Total Revenue) * Days
        const paidInvoices = invoices.filter((i) => i.status === "paid");
        const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0);
        const dso = totalRevenue > 0 ? Math.round((grandTotal / (totalRevenue + grandTotal)) * 90) : 0;

        if (unpaid.length === 0) return null;

        return (
          <div style={{
            background: "var(--bg-card)", borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-color)", padding: 20, marginBottom: 24,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Receivables Aging</h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  {unpaid.length} unpaid invoice{unpaid.length !== 1 ? "s" : ""} · {formatCurrency(grandTotal)} outstanding
                </p>
              </div>
              <div style={{
                background: "rgba(99, 102, 241, 0.1)", borderRadius: 8, padding: "8px 16px",
                border: "1px solid rgba(99, 102, 241, 0.2)", textAlign: "center",
              }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>DSO</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent-purple)" }}>{dso}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>days</div>
              </div>
            </div>

            {/* Stacked Bar */}
            {grandTotal > 0 && (
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 28, marginBottom: 16, background: "var(--bg-input)" }}>
                {bucketTotals.filter((b) => b.total > 0).map((b) => (
                  <div
                    key={b.label}
                    title={`${b.label}: ${formatCurrency(b.total)} (${b.count} invoice${b.count !== 1 ? "s" : ""})`}
                    style={{
                      width: `${(b.total / grandTotal) * 100}%`,
                      background: b.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, color: "#fff",
                      minWidth: b.total > 0 ? 24 : 0,
                      transition: "width 0.4s ease",
                      cursor: "default",
                    }}
                  >
                    {(b.total / grandTotal) > 0.1 ? `${Math.round((b.total / grandTotal) * 100)}%` : ""}
                  </div>
                ))}
              </div>
            )}

            {/* Bucket Cards */}
            <div className="responsive-grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {bucketTotals.map((b) => (
                <div
                  key={b.label}
                  style={{
                    padding: "12px 14px", borderRadius: 10,
                    background: b.count > 0 ? `${b.color}12` : "var(--bg-input)",
                    border: `1px solid ${b.count > 0 ? `${b.color}30` : "var(--border-color)"}`,
                    transition: "transform 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>{b.label}</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: b.count > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {b.count > 0 ? formatCurrency(b.total) : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {b.count} invoice{b.count !== 1 ? "s" : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Invoice List */}
      {loading ? (
        <div className="table-container">
          <SkeletonTable rows={4} />
        </div>
      ) : (
        <DataTable
          data={invoices}
          columns={invoiceColumns}
          searchPlaceholder="Search invoice number or client..."
          searchFilter={searchFilter}
          onRowClick={(inv) => setSelectedInvoice(inv)}
          emptyState={
            <EmptyState
              icon={FileText}
              title="No invoices yet"
              description="Create your first invoice to start tracking receivables"
              action={
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                  <Plus size={16} /> Create Invoice
                </button>
              }
            />
          }
        />
      )}

      {/* Create Invoice Modal */}
      {showCreate && (
        <AccessibleModal open={showCreate} onClose={() => setShowCreate(false)} titleId="create-invoice-title">
            <div className="modal-header">
              <h3 id="create-invoice-title">Create Invoice</h3>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)} aria-label="Close create invoice">
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Client</label>
              <select className="form-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— No client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input type="date" className="form-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={isInterState} onChange={(e) => setIsInterState(e.target.checked)} />
                  Inter-State (IGST)
                </label>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Line Items</label>
              {lineItems.map((item, i) => (
                <div key={i} className="responsive-line-items" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <input className="form-input" placeholder="Description" value={item.description} onChange={(e) => updateLineItem(i, "description", e.target.value)} />
                  <input className="form-input" type="number" placeholder="Qty" value={item.quantity} onChange={(e) => updateLineItem(i, "quantity", Number(e.target.value))} />
                  <input className="form-input" type="number" placeholder="Price" value={item.unitPrice || ""} onChange={(e) => updateLineItem(i, "unitPrice", Number(e.target.value))} />
                  <select className="form-input" value={item.gstRate} onChange={(e) => updateLineItem(i, "gstRate", Number(e.target.value))}>
                    <option value={0}>0%</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeLineItem(i)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm" onClick={addLineItem}>
                <Plus size={14} /> Add Item
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-input" placeholder="Additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createInvoice}><FileText size={16} /> Create Invoice</button>
            </div>
        </AccessibleModal>
      )}

      {/* View Invoice Modal */}
      {selectedInvoice && (
        <AccessibleModal open={!!selectedInvoice} onClose={() => setSelectedInvoice(null)} titleId="view-invoice-title">
            <div className="modal-header">
              <h3 id="view-invoice-title">{selectedInvoice.invoiceNumber}</h3>
              <button className="btn btn-ghost" onClick={() => setSelectedInvoice(null)} aria-label="Close invoice details">
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <span className={`badge ${selectedInvoice.status}`}>{selectedInvoice.status}</span>
              </div>
              <div style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: 13 }}>
                <div>Issued: {new Date(selectedInvoice.issueDate).toLocaleDateString("en-IN")}</div>
                <div>Due: {new Date(selectedInvoice.dueDate).toLocaleDateString("en-IN")}</div>
              </div>
            </div>

            {selectedInvoice.client && (
              <div style={{ marginBottom: 20, padding: 16, background: "var(--bg-input)", borderRadius: "var(--radius-md)" }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>BILL TO</p>
                <p style={{ fontWeight: 600 }}>{selectedInvoice.client.name}</p>
                {selectedInvoice.client.company && (
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{selectedInvoice.client.company}</p>
                )}
              </div>
            )}

            <table style={{ marginBottom: 20, fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ background: "transparent" }}>Item</th>
                  <th style={{ background: "transparent" }}>Qty</th>
                  <th style={{ background: "transparent" }}>Price</th>
                  <th style={{ background: "transparent", textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoice.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td>{li.description}</td>
                    <td>{li.quantity}</td>
                    <td>{formatCurrency(li.unitPrice, selectedInvoice.currency)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrency(li.total, selectedInvoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14 }}>
                <span style={{ color: "var(--text-secondary)" }}>Subtotal</span>
                <span>{formatCurrency(selectedInvoice.subtotal, selectedInvoice.currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14 }}>
                <span style={{ color: "var(--text-secondary)" }}>Tax</span>
                <span>{formatCurrency(selectedInvoice.taxTotal, selectedInvoice.currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 800 }}>
                <span>Total</span>
                <span>{formatCurrency(selectedInvoice.total, selectedInvoice.currency)}</span>
              </div>
            </div>

            {/* Partial Payment */}
            {(selectedInvoice.status === "sent" || selectedInvoice.status === "overdue") && (
              <div style={{ padding: "12px 16px", marginBottom: 12, background: "rgba(99,102,241,0.05)", borderRadius: 8, border: "1px solid rgba(99,102,241,0.15)" }}>
                {showPayment ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedInvoice.currency === "EUR" ? "€" : selectedInvoice.currency === "GBP" ? "£" : selectedInvoice.currency === "USD" ? "$" : "₹"}</span>
                    <input className="input" type="number" placeholder="Payment amount" value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)} style={{ flex: 1, fontSize: 13 }} />
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }}
                      onClick={() => recordPayment(selectedInvoice.id)}>Record</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }}
                      onClick={() => setShowPayment(false)}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn btn-secondary" style={{ width: "100%", fontSize: 12 }}
                    onClick={() => setShowPayment(true)}><CreditCard size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> Record Partial Payment</button>
                )}
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => downloadPDF(selectedInvoice.id, selectedInvoice.invoiceNumber)}>
                <Download size={16} /> Download PDF
              </button>
              {selectedInvoice.client?.email && selectedInvoice.status !== "paid" && (
                <button
                  className="btn btn-secondary"
                  onClick={() => emailInvoice(selectedInvoice.id)}
                  disabled={sendingEmail === selectedInvoice.id}
                >
                  {sendingEmail === selectedInvoice.id ? <Loader2 size={16} className="loading" /> : <Mail size={16} />}
                  Email Invoice
                </button>
              )}
              {selectedInvoice.status === "draft" && (
                <button className="btn btn-primary" onClick={() => performAction(selectedInvoice.id, "send")}>
                  <Send size={16} /> Send Invoice
                </button>
              )}
              {(selectedInvoice.status === "sent" || selectedInvoice.status === "overdue") && (
                <button className="btn btn-success" onClick={() => performAction(selectedInvoice.id, "paid")}>
                  <CheckCircle size={16} /> Mark as Paid
                </button>
              )}
            </div>
        </AccessibleModal>
      )}
    </div>
  );
}
