"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import { Receipt, Calendar, Building2, CheckCircle2, Download } from "lucide-react";
import { PageHeader } from "@/components/page-header";

interface VendorTDS {
  vendor: string;
  totalAmount: number;
  tdsSection: string;
  tdsRate: number;
  tdsAmount: number;
  netPayable: number;
  transactions: number;
}

interface TDSData {
  quarter: string;
  fiscalYear: string;
  summary: {
    totalGross: number;
    totalTDS: number;
    totalNet: number;
    vendorCount: number;
  };
  vendors: VendorTDS[];
  quarters: { quarter: string; months: string; dueDate: string }[];
  currentQuarter: { quarter: string };
}

import { formatCurrency } from "@/lib/currency";
const fmt = (n: number) => formatCurrency(n);

export default function TDSPage() {
  const [data, setData] = useState<TDSData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedQ, setSelectedQ] = useState("");

  async function load(q?: string) {
    setLoading(true);
    try {
      const qs = q ? `?quarter=${q}` : "";
      const res = await fetch(`/api/tds${qs}`);
      const d = await res.json();
      setData(d);
      if (!q) setSelectedQ(d.currentQuarter?.quarter || "Q1");
    } catch (err) {
      clientLog.error("Failed to load TDS data", "tds", "load", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function changeQuarter(q: string) {
    setSelectedQ(q);
    load(q);
  }

  async function downloadForm16A(vendor: string) {
    const qs = `?vendor=${encodeURIComponent(vendor)}&quarter=${selectedQ}`;
    const res = await fetch(`/api/tds/form16a${qs}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Form16A_${vendor}_${selectedQ}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !data) {
    return (
      <div>
        <PageHeader title="TDS Compliance" description="Tax Deducted at Source" />
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Loading TDS data...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="TDS Compliance" description={`${data.fiscalYear} — Tax Deducted at Source`}>
        <div style={{ display: "flex", gap: 8 }}>
          {data.quarters.map((q) => (
            <button
              key={q.quarter}
              onClick={() => changeQuarter(q.quarter)}
              className={selectedQ === q.quarter ? "btn btn-primary" : "btn btn-secondary"}
              style={{ fontSize: 12, padding: "6px 14px" }}
            >
              {q.quarter} ({q.months})
            </button>
          ))}
        </div>
      </PageHeader>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-label">Gross Payments</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(data.summary.totalGross)}</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label">TDS Deducted</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(data.summary.totalTDS)}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Net Payable</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{fmt(data.summary.totalNet)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Vendors</div>
          <div className="kpi-value" style={{ fontSize: 28 }}>{data.summary.vendorCount}</div>
        </div>
      </div>

      {/* Filing Status */}
      <div style={{
        padding: "14px 20px", marginBottom: 20, background: "var(--bg-card)",
        borderRadius: 10, border: "1px solid var(--border-color)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Calendar size={16} />
          <span style={{ fontSize: 13 }}>
            Filing due: <strong>{data.quarters.find((q) => q.quarter === selectedQ)?.dueDate || "—"}</strong>
          </span>
        </div>
        <span style={{
          padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
          background: "rgba(234,179,8,0.15)", color: "#F59E0B",
        }}>
          PENDING
        </span>
      </div>

      {/* Vendor-wise TDS Table */}
      {data.vendors.length === 0 ? (
        <div style={{
          textAlign: "center", padding: 60, background: "var(--bg-card)",
          borderRadius: 16, border: "1px solid var(--border-color)",
        }}>
          <CheckCircle2 size={40} style={{ color: "#22C55E", marginBottom: 12 }} />
          <h3 style={{ margin: "0 0 8px" }}>No TDS-applicable payments this quarter</h3>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
            Professional services, rent, and contractor payments will appear here
          </p>
        </div>
      ) : (
        <div className="table-container">
          <div className="table-header">
            <h3><Building2 size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />Vendor-wise TDS Breakdown</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th scope="col">Vendor</th>
                <th scope="col">Section</th>
                <th scope="col" style={{ textAlign: "center" }}>Txns</th>
                <th scope="col" style={{ textAlign: "right" }}>Gross Amount</th>
                <th scope="col" style={{ textAlign: "center" }}>Rate</th>
                <th scope="col" style={{ textAlign: "right" }}>TDS Amount</th>
                <th scope="col" style={{ textAlign: "right" }}>Net Payable</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{v.vendor}</td>
                  <td>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: "rgba(99,102,241,0.12)", color: "#818CF8",
                    }}>
                      {v.tdsSection}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>{v.transactions}</td>
                  <td style={{ textAlign: "right" }}>{fmt(v.totalAmount)}</td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ fontWeight: 700, color: "#F59E0B" }}>{v.tdsRate}%</span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "#EF4444" }}>{fmt(v.tdsAmount)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(v.netPayable)}</td>
                  <td><button className="btn btn-secondary" style={{ fontSize: 10, padding: "3px 8px" }} onClick={() => downloadForm16A(v.vendor)}><Download size={12} /> 16A</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800, fontSize: 14 }}>
                <td colSpan={3}>Total</td>
                <td style={{ textAlign: "right" }}>{fmt(data.summary.totalGross)}</td>
                <td></td>
                <td style={{ textAlign: "right", color: "#EF4444" }}>{fmt(data.summary.totalTDS)}</td>
                <td style={{ textAlign: "right" }}>{fmt(data.summary.totalNet)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
