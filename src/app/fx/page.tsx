"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import { ArrowRightLeft, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { PageHeader } from "@/components/page-header";

interface Rate {
  code: string;
  name: string;
  symbol: string;
  rateToINR: number;
}

export default function FxPage() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [_loading, setLoading] = useState(true);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("INR");
  const [amount, setAmount] = useState("1000");
  const [converted, setConverted] = useState(0);
  const [rate, setRate] = useState(0);

  async function loadRates() {
    setLoading(true);
    try {
      const res = await fetch(`/api/fx/rates?from=${from}&to=${to}&amount=${amount}`);
      const data = await res.json();
      setRates(data.allRates || []);
      setIsLive(data.isLive);
      setConverted(data.converted);
      setRate(data.rate);
    } catch (err) {
      clientLog.error("Failed to load FX rates", "fx", "load", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRates(); }, [from, to, amount]);

  function swap() {
    setFrom(to);
    setTo(from);
  }

  const fmtINR = (n: number) => formatCurrency(n, "INR", { decimals: 2 });

  return (
    <div>
      <PageHeader title="Currency & FX Rates" description="Exchange rates and multi-currency converter" />

      {/* Converter */}
      <div style={{
        padding: 28, marginBottom: 24, background: "var(--bg-card)",
        borderRadius: 16, border: "1px solid var(--border-color)",
      }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>Amount</label>
            <input
              className="input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ fontSize: 18, fontWeight: 700, padding: "10px 14px" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>From</label>
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)} style={{ fontSize: 15, padding: "10px 14px" }}>
              {rates.map((r) => <option key={r.code} value={r.code}>{r.code} — {r.name}</option>)}
            </select>
          </div>
          <button
            onClick={swap}
            style={{
              background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
              borderRadius: 10, padding: "10px 14px", cursor: "pointer", color: "var(--text-primary)",
            }}
          >
            <ArrowRightLeft size={18} aria-hidden="true" />
          </button>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>To</label>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)} style={{ fontSize: 15, padding: "10px 14px" }}>
              {rates.map((r) => <option key={r.code} value={r.code}>{r.code} — {r.name}</option>)}
            </select>
          </div>
        </div>

        {/* Result */}
        <div style={{
          marginTop: 20, padding: "16px 20px", borderRadius: 12,
          background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>Converted Amount</p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#6366F1" }}>
              {rates.find((r) => r.code === to)?.symbol || ""}{converted.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>Rate</p>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>1 {from} = {rate} {to}</p>
            <p style={{ margin: 0, fontSize: 11, color: isLive ? "#22C55E" : "#F59E0B" }}>
              {isLive ? "● Live rate" : "● Static rate"}
            </p>
          </div>
        </div>
      </div>

      {/* Rate Table */}
      <div className="table-container">
        <div className="table-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>All Rates (vs INR)</h3>
          <button className="btn btn-secondary" onClick={loadRates} style={{ fontSize: 12, padding: "4px 12px" }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col">Code</th>
              <th scope="col" style={{ textAlign: "right" }}>1 Unit = ₹</th>
              <th scope="col" style={{ textAlign: "right" }}>₹1,00,000 =</th>
            </tr>
          </thead>
          <tbody>
            {rates.filter((r) => r.code !== "INR").map((r) => (
              <tr key={r.code}>
                <td>
                  <span style={{ fontWeight: 600 }}>{r.symbol}</span>{" "}
                  <span style={{ color: "var(--text-secondary)" }}>{r.name}</span>
                </td>
                <td>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                    background: "rgba(99,102,241,0.1)", color: "#818CF8",
                  }}>
                    {r.code}
                  </span>
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtINR(r.rateToINR)}</td>
                <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                  {r.rateToINR > 0 ? `${r.symbol}${(100000 / r.rateToINR).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
