"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import { FileText, Calendar, ArrowDown, ArrowUp, Minus, Search, Download } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface GSTR3BData {
  type: string;
  period: string;
  filingDue: string;
  outwardSupplies: {
    taxableValue: number;
    cgst: number; sgst: number; igst: number;
    totalTax: number; invoiceCount: number;
  };
  inputTaxCredit: {
    cgst: number; sgst: number; igst: number;
    totalITC: number; expenseCount: number;
  };
  netTaxPayable: {
    cgst: number; sgst: number; igst: number; total: number;
  };
}

interface GSTR1Entry {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGSTIN: string;
  taxableValue: number;
  cgst: number; sgst: number; igst: number;
  invoiceValue: number;
}

interface GSTR1Data {
  type: string;
  period: string;
  filingDue: string;
  b2b: { count: number; entries: GSTR1Entry[]; totalTaxable: number; totalTax: number };
  b2c: { count: number; totalTaxable: number; cgst: number; sgst: number; igst: number };
  totalInvoices: number;
}

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n, "INR", { decimals: 2 });

export default function GSTReturnsPage() {
  const [view, setView] = useState<"gstr3b" | "gstr1" | "hsn" | "einvoice">("gstr3b");
  const [data3b, setData3b] = useState<GSTR3BData | null>(null);
  const [data1, setData1] = useState<GSTR1Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [hsnQuery, setHsnQuery] = useState("");
  const [hsnResults, setHsnResults] = useState<{code: string; description: string; rate?: number; gstRate?: number; type?: string}[]>([]);
  const [hsnLoading, setHsnLoading] = useState(false);
  const [einvoiceData, setEinvoiceData] = useState<Record<string, unknown> | null>(null);
  const [einvoiceId, setEinvoiceId] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function syncToClearTax(action: "gstr1" | "gstr3b") {
    setSyncing(true);
    try {
      const res = await fetch("/api/gst/cleartax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, period: month }),
      });
      const data = await res.json();
      if (res.ok) alert(data.message);
      else alert(data.error || "Failed to sync to ClearTax");
    } catch (e) {
      clientLog.error("Failed to load GST data", "gst", "load", e);
      alert("An error occurred while syncing.");
    } finally {
      setSyncing(false);
    }
  }

  async function searchHSN() {
    if (!hsnQuery) return;
    setHsnLoading(true);
    try {
      const res = await fetch(`/api/gst/hsn?q=${encodeURIComponent(hsnQuery)}`);
      const data = await res.json();
      setHsnResults(data.results || data.codes || []);
    } catch (e) { clientLog.error("Failed to file return", "gst", "file-return", e); }
    finally { setHsnLoading(false); }
  }

  async function generateEinvoice() {
    if (!einvoiceId) return;
    try {
      const res = await fetch(`/api/gst/einvoice?invoiceId=${einvoiceId}`);
      const data = await res.json();
      setEinvoiceData(data);
    } catch (e) { clientLog.error("Failed to search HSN", "gst", "hsn-search", e); }
  }

  async function load() {
    setLoading(true);
    try {
      const [r3b, r1] = await Promise.all([
        fetch(`/api/gst/returns?type=gstr3b&month=${month}`).then((r) => r.json()),
        fetch(`/api/gst/returns?type=gstr1&month=${month}`).then((r) => r.json()),
      ]);
      if (r3b && !r3b.error) setData3b(r3b);
      if (r1 && !r1.error) setData1(r1);
    } catch (err) {
      clientLog.error("Failed to generate e-invoice", "gst", "e-invoice", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [month]);

  return (
    <div>
      <PageHeader title="GST Returns" description="GSTR-1 Sales Register & GSTR-3B Monthly Summary">
        <input
          type="month" value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{
            background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
            borderRadius: 8, padding: "6px 12px", color: "var(--text-primary)", fontSize: 13,
          }}
        />
      </PageHeader>

      {/* Toggle */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 20,
        background: "var(--bg-secondary)", padding: 4, borderRadius: 8, width: "fit-content",
      }}>
        {(["gstr3b", "gstr1", "hsn", "einvoice"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setView(t)}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none", fontSize: 13,
              fontWeight: 600, cursor: "pointer",
              background: view === t ? "var(--bg-card)" : "transparent",
              color: view === t ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: view === t ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
            }}
          >
            {t === "gstr3b" ? "GSTR-3B" : t === "gstr1" ? "GSTR-1" : t === "hsn" ? "HSN Lookup" : "E-Invoice"}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Loading GST data...</div>
      ) : view === "gstr3b" && data3b ? (
        <>
          {/* Filing Due */}
          <div style={{
            padding: "12px 20px", marginBottom: 20, background: "var(--bg-card)",
            borderRadius: 10, border: "1px solid var(--border-color)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={14} /> GSTR-3B due: <strong>{data3b?.filingDue}</strong>
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "rgba(234,179,8,0.15)", color: "#F59E0B" }}>PENDING</span>
              <button 
                className="btn btn-primary btn-sm" 
                onClick={() => syncToClearTax("gstr3b")}
                disabled={syncing}
              >
                <ArrowUp size={14} /> {syncing ? "Syncing..." : "Sync to ClearTax"}
              </button>
            </div>
          </div>

          {/* 3B Summary Table */}
          <div className="table-container" style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 16 }}>GSTR-3B Summary — {data3b?.period}</h3>
            <table>
              <thead>
                <tr>
                  <th scope="col">Particulars</th>
                  <th style={{ textAlign: "right" }}>CGST</th>
                  <th style={{ textAlign: "right" }}>SGST</th>
                  <th style={{ textAlign: "right" }}>IGST</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <ArrowUp size={14} color="#EF4444" /> Outward Supplies ({data3b?.outwardSupplies?.invoiceCount ?? 0} invoices)
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmt(data3b?.outwardSupplies.cgst || 0)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(data3b?.outwardSupplies.sgst || 0)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(data3b?.outwardSupplies.igst || 0)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(data3b?.outwardSupplies.totalTax || 0)}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <ArrowDown size={14} color="#22C55E" /> Input Tax Credit ({data3b?.inputTaxCredit?.expenseCount ?? 0} expenses)
                    </span>
                  </td>
                  <td style={{ textAlign: "right", color: "var(--accent-green)" }}>- {fmt(data3b?.inputTaxCredit.cgst || 0)}</td>
                  <td style={{ textAlign: "right", color: "var(--accent-green)" }}>- {fmt(data3b?.inputTaxCredit.sgst || 0)}</td>
                  <td style={{ textAlign: "right", color: "var(--accent-green)" }}>- {fmt(data3b?.inputTaxCredit.igst || 0)}</td>
                  <td style={{ textAlign: "right", color: "var(--accent-green)", fontWeight: 700 }}>- {fmt(data3b?.inputTaxCredit.totalITC || 0)}</td>
                </tr>
                <tr style={{ fontSize: 16, fontWeight: 800, borderTop: "2px solid var(--border-color)" }}>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Minus size={14} /> Net Tax Payable
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmt(data3b?.netTaxPayable.cgst || 0)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(data3b?.netTaxPayable.sgst || 0)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(data3b?.netTaxPayable.igst || 0)}</td>
                  <td style={{ textAlign: "right", color: (data3b?.netTaxPayable.total || 0) > 0 ? "#EF4444" : "#22C55E" }}>
                    {fmt(data3b?.netTaxPayable.total || 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Taxable Supply KPI */}
          <div style={{
            marginTop: 16, padding: "14px 20px", background: "var(--bg-card)",
            borderRadius: 10, border: "1px solid var(--border-color)",
            display: "flex", justifyContent: "space-between",
          }}>
            <span>Taxable Value of Outward Supplies</span>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{fmt(data3b?.outwardSupplies.taxableValue || 0)}</span>
          </div>
        </>
      ) : view === "gstr1" && data1 ? (
        <>
          {/* Filing Due */}
          <div style={{
            padding: "12px 20px", marginBottom: 20, background: "var(--bg-card)",
            borderRadius: 10, border: "1px solid var(--border-color)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={14} /> GSTR-1 due: <strong>{data1?.filingDue}</strong>
              <span style={{ marginLeft: 16 }}>Total Invoices: <strong>{data1?.totalInvoices}</strong></span>
            </span>
            <button 
              className="btn btn-primary btn-sm" 
              onClick={() => syncToClearTax("gstr1")}
              disabled={syncing}
            >
              <ArrowUp size={14} /> {syncing ? "Syncing..." : "Sync to ClearTax"}
            </button>
          </div>

          {/* B2B Sales */}
          {(data1?.b2b.count ?? 0) > 0 && (
            <div className="table-container" style={{ marginBottom: 16 }}>
              <div className="table-header">
                <h3>B2B Sales — Registered Buyers ({data1?.b2b.count})</h3>
              </div>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Date</th>
                    <th scope="col">Customer</th>
                    <th scope="col">GSTIN</th>
                    <th style={{ textAlign: "right" }}>Taxable</th>
                    <th style={{ textAlign: "right" }}>Tax</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data1?.b2b.entries.map((ent) => (
                    <tr key={ent.invoiceNumber}>
                      <td><span style={{ background: "rgba(59,130,246,0.1)", color: "var(--brand-primary)", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{ent.invoiceNumber}</span></td>
                      <td>{ent.invoiceDate}</td>
                      <td>{ent.customerName}</td>
                      <td style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>{ent.customerGSTIN}</td>
                      <td style={{ textAlign: "right" }}>{fmt(ent.taxableValue)}</td>
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{fmt(ent.cgst + ent.sgst + ent.igst)}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(ent.invoiceValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={4}>B2B Total</td>
                    <td style={{ textAlign: "right" }}>{fmt(data1?.b2b.totalTaxable || 0)}</td>
                    <td style={{ textAlign: "right", color: "#F59E0B" }}>{fmt(data1?.b2b.totalTax || 0)}</td>
                    <td style={{ textAlign: "right" }}>{fmt((data1?.b2b.totalTaxable || 0) + (data1?.b2b.totalTax || 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* B2C Summary */}
          {(data1?.b2c.count ?? 0) > 0 && (
            <div className="table-container" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 12 }}>B2C Sales — Unregistered Buyers ({data1?.b2c.count})</h3>
              <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>TAXABLE VALUE</p>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{fmt(data1?.b2c.totalTaxable || 0)}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>CGST</p>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{fmt(data1?.b2c.cgst || 0)}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>SGST</p>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{fmt(data1?.b2c.sgst || 0)}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>IGST</p>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{fmt(data1?.b2c.igst || 0)}</p>
                </div>
              </div>
            </div>
          )}
        </>
      ) : view === "hsn" ? (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input className="input" placeholder="Search HSN/SAC code or description..." value={hsnQuery} onChange={(e) => setHsnQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchHSN()} style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={searchHSN} disabled={hsnLoading}><Search size={16} /> Search</button>
          </div>
          {hsnResults.length > 0 && (
            <div className="table-container">
              <table>
                <thead><tr><th scope="col">Code</th><th scope="col">Description</th><th scope="col">Rate</th><th scope="col">Type</th></tr></thead>
                <tbody>
                  {hsnResults.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{r.code}</td>
                      <td>{r.description}</td>
                      <td style={{ fontWeight: 600 }}>{r.rate || r.gstRate}%</td>
                      <td><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "rgba(99,102,241,0.12)", color: "#818CF8" }}>{r.type || "HSN"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : view === "einvoice" ? (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input className="input" placeholder="Enter Invoice ID to generate e-invoice JSON" value={einvoiceId} onChange={(e) => setEinvoiceId(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={generateEinvoice}><FileText size={16} /> Generate</button>
          </div>
          {einvoiceData && (
            <div className="table-container" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>E-Invoice JSON</h3>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => {
                  const blob = new Blob([JSON.stringify(einvoiceData, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = "einvoice.json"; a.click();
                }}><Download size={12} /> Download JSON</button>
              </div>
              <pre style={{ background: "var(--bg-secondary)", padding: 16, borderRadius: 8, fontSize: 12, overflow: "auto", maxHeight: 400 }}>{JSON.stringify(einvoiceData, null, 2)}</pre>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="No GST data for this period"
          description="Create invoices or record expenses with GST to generate return data for this filing period."
          action={
            <a href="/invoices?new=1" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Create Invoice
            </a>
          }
        />
      )}
    </div>
  );
}
