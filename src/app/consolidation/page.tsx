"use client";

import { useEffect, useState } from "react";
import { Globe, Building2, TrendingUp, DollarSign, ArrowRight, Target, Shield } from "lucide-react";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/currency";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface ConsolidationData {
  hq: { id: string; name: string; baseCurrency: string; type: string };
  global: { 
    totalCash: number; 
    mrr: number; 
    mtdBurn: number; 
    receivables: number; 
    netRunRate: number;
    eliminations?: { mrr: number; burn: number };
  };
  subsidiaries: {
    id: string;
    name: string;
    type: string;
    localCurrency: string;
    cash: number;
    mrr: number;
    burn: number;
    receivables: number;
    baseCash: number;
    baseMrr: number;
  }[];
}

export default function HQConsolidationPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ConsolidationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/consolidation")
      .then(res => res.json())
      .then(d => {
        if (d.error) {
           toast(d.error, "error");
        } else {
           setData(d);
        }
        setLoading(false);
      })
      .catch(() => {
        toast("Failed to load HQ Rollup", "error");
        setLoading(false);
      });
  }, []);

  if (loading) return <div style={{ padding: 80, textAlign: "center", color: "#6B7280" }}>Aggregating Global Entities...</div>;
  if (!data) return (
    <div>
      <PageHeader title="Global HQ Rollup" description="Real-time Multi-Entity consolidation" />
      <EmptyState
        icon={Globe}
        title="No consolidation data"
        description="Set up subsidiaries and import financial data to see global HQ rollup."
        action={
          <a href="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Import Data
          </a>
        }
      />
    </div>
  );

  const { hq, global, subsidiaries } = data;

  return (
    <div>
      <PageHeader title="Global HQ Rollup" description={`Real-time Multi-Entity consolidation to ${hq?.baseCurrency} Base Currency`}>
        <button className="btn btn-secondary">
          <Building2 size={16} /> Add Subsidiary
        </button>
      </PageHeader>

      {/* Global State KPIs */}
      <div className="responsive-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, marginBottom: 32 }}>
        <div style={{ backgroundColor: "#0F172A", padding: 24, borderRadius: 12, border: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94A3B8", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <DollarSign size={16} /> Consolidated Cash
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#38BDF8" }}>
             {formatCurrency(global.totalCash, hq.baseCurrency)}
          </div>
        </div>

        <div style={{ backgroundColor: "#0F172A", padding: 24, borderRadius: 12, border: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94A3B8", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <TrendingUp size={16} /> Global MRR
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#34D399" }}>
             {formatCurrency(global.mrr, hq.baseCurrency)}
          </div>
          {global.eliminations && global.eliminations.mrr > 0 && (
             <div style={{ fontSize: 12, color: "#64748B", marginTop: 8 }}>
                - {formatCurrency(global.eliminations.mrr, hq.baseCurrency)} eliminated
             </div>
          )}
        </div>

        <div style={{ backgroundColor: "#0F172A", padding: 24, borderRadius: 12, border: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94A3B8", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <Target size={16} /> Global Burn (MTD)
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#F87171" }}>
            {formatCurrency(global.mtdBurn, hq.baseCurrency)}
          </div>
          {global.eliminations && global.eliminations.burn > 0 && (
             <div style={{ fontSize: 12, color: "#64748B", marginTop: 8 }}>
                - {formatCurrency(global.eliminations.burn, hq.baseCurrency)} eliminated
             </div>
          )}
        </div>

        <div style={{ backgroundColor: "#0F172A", padding: 24, borderRadius: 12, border: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94A3B8", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <Shield size={16} /> Net Run Rate
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: global.netRunRate >= 0 ? "#34D399" : "#F87171" }}>
            {formatCurrency(global.netRunRate, hq.baseCurrency)}
          </div>
        </div>
      </div>

      {/* Corporate Structure Ledger Matrix */}
      <h3 style={{ fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Subsidiary Ledger Matrix</h3>
      <div style={{ backgroundColor: "#0F172A", borderRadius: 12, border: "1px solid #1E293B", overflow: "hidden" }}>
         <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
           <thead>
             <tr style={{ borderBottom: "1px solid #1E293B", backgroundColor: "#020617" }}>
               <th style={{ padding: "16px 24px", color: "#64748B", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Entity Name</th>
               <th style={{ padding: "16px 24px", color: "#64748B", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "center" }}>Role</th>
               <th style={{ padding: "16px 24px", color: "#64748B", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "right" }}>Native Cash</th>
               <th style={{ padding: "16px 24px", color: "#64748B", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "right" }}>Native MRR</th>
               <th style={{ padding: "16px 24px", color: "#64748B", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "right", backgroundColor: "rgba(59,130,246,0.05)" }}>Converted {hq.baseCurrency} Cash</th>
             </tr>
           </thead>
           <tbody>
             {subsidiaries.map((sub) => (
                <tr key={sub.id} style={{ borderBottom: "1px solid #1E293B" }}>
                   <td style={{ padding: "16px 24px", fontWeight: 600, color: sub.type === 'hq' ? "#60A5FA" : "#E2E8F0" }}>
                      {sub.type === "hq" && <Globe size={14} style={{ display: "inline", marginRight: 8, verticalAlign: "-2px" }}/>}
                      {sub.type === "subsidiary" && <ArrowRight size={14} style={{ display: "inline", marginRight: 8, verticalAlign: "-2px", color: "#64748B" }} />}
                      {sub.name}
                   </td>
                   <td style={{ padding: "16px 24px", textAlign: "center" }}>
                      <span style={{ padding: "4px 8px", backgroundColor: sub.type === "hq" ? "rgba(59,130,246,0.1)" : "rgba(148,163,184,0.1)", color: sub.type === "hq" ? "#60A5FA" : "#94A3B8", borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                         {sub.type}
                      </span>
                   </td>
                   <td style={{ padding: "16px 24px", textAlign: "right", color: "#94A3B8", fontFamily: "monospace" }}>
                      {formatCurrency(sub.cash, sub.localCurrency)}
                   </td>
                   <td style={{ padding: "16px 24px", textAlign: "right", color: "#94A3B8", fontFamily: "monospace" }}>
                      {formatCurrency(sub.mrr, sub.localCurrency)}
                   </td>
                   <td style={{ padding: "16px 24px", textAlign: "right", color: "#38BDF8", fontWeight: 700, fontFamily: "monospace", backgroundColor: "rgba(59,130,246,0.02)" }}>
                      {formatCurrency(sub.baseCash, hq.baseCurrency)}
                   </td>
                </tr>
             ))}
             {subsidiaries.length === 0 && (
                <tr>
                   <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#64748B" }}>No entities linked.</td>
                </tr>
             )}
           </tbody>
         </table>
      </div>

    </div>
  );
}
