"use client";

import { useState, useEffect } from "react";
import { FileText } from "lucide-react";
import { SkeletonTable } from "@/components/skeleton";
import { formatCurrency } from "@/lib/currency";

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  total: string;
  client?: { name: string };
}

export default function EmbeddedInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real embedded scenario, this might use a token from the URL to authenticate
    fetch("/api/invoices")
      .then((res) => res.json())
      .then((d) => {
        setInvoices(d.invoices || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);


  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={20} style={{ color: "var(--accent-blue)" }} />
          Embedded Invoices Module
        </h2>
      </div>

      <div className="table-container" style={{ border: "1px solid var(--border-color)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "var(--bg-secondary)", textAlign: "left" }}>
            <tr>
              <th style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>Invoice No</th>
              <th style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>Client</th>
              <th style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>Status</th>
              <th style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: 16 }}><SkeletonTable rows={3} /></td></tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
                  No invoices found.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 500 }}>{inv.invoiceNumber}</td>
                  <td style={{ padding: "12px 16px" }}>{inv.client?.name || "—"}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span className={`badge ${inv.status}`}>{inv.status}</span>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600 }}>{formatCurrency(Number(inv.total))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
