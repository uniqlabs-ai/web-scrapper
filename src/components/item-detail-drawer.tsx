"use client";

import { X, Calendar, Tag, FileText, Building2, Receipt, Layers } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

interface ExpenseItem {
  id: string;
  description: string;
  amount: number;
  currency?: string;
  date: string;
  vendor?: string;
  notes?: string;
  source?: string;
  department?: string;
  isRecurring?: boolean;
  category?: { name: string; color?: string };
  receipt?: string;
}

interface RevenueItem {
  id: string;
  month: string;
  amount: number;
  currency?: string;
  type: string;
  category?: string;
  source?: string;
  notes?: string;
  client?: { name: string; company?: string };
}

interface ExpenseDrawerProps {
  open: boolean;
  onClose: () => void;
  item: ExpenseItem | null;
}

interface RevenueDrawerProps {
  open: boolean;
  onClose: () => void;
  item: RevenueItem | null;
}

function DrawerShell({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 998,
        backdropFilter: "blur(4px)", transition: "opacity 0.2s",
      }} />
      <div style={{
        position: "fixed", right: 0, top: 0, bottom: 0, width: 480, maxWidth: "90vw",
        background: "var(--bg-card)", borderLeft: "1px solid var(--border-color)",
        zIndex: 999, overflowY: "auto", boxShadow: "-8px 0 32px rgba(0,0,0,0.3)",
        animation: "slideInRight 0.25s ease-out",
      }}>
        {children}
      </div>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}

function InfoRow({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: React.ReactNode; color?: string;
}) {
  if (!value || value === "—") return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: `${color || "rgba(99,102,241,0.15)"}`, flexShrink: 0,
      }}>
        <Icon size={14} style={{ color: color ? "#fff" : "#818CF8" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
      </div>
    </div>
  );
}

export function ExpenseDetailDrawer({ open, onClose, item }: ExpenseDrawerProps) {
  if (!item) return null;

  return (
    <DrawerShell open={open} onClose={onClose}>
      {/* Header */}
      <div style={{
        padding: "20px 24px", borderBottom: "1px solid var(--border-color)",
        background: "linear-gradient(135deg, rgba(239,68,68,0.08) 0%, transparent 60%)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Expense Detail</div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{item.description}</h3>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 8, padding: 8,
            cursor: "pointer", color: "var(--text-secondary)",
          }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Amount Card */}
      <div style={{ padding: "16px 24px" }}>
        <div style={{
          padding: 20, borderRadius: 12, background: "linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.03) 100%)",
          border: "1px solid rgba(239,68,68,0.15)", textAlign: "center",
        }}>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Amount</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#EF4444" }}>
            {formatCurrency(item.amount, item.currency)}
          </div>
        </div>
      </div>

      {/* Details */}
      <div style={{ padding: "0 24px 24px" }}>
        <InfoRow icon={Calendar} label="Date" value={new Date(item.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", weekday: "long" })} />
        <InfoRow icon={Building2} label="Vendor" value={item.vendor || "—"} />
        {item.category && (
          <InfoRow icon={Tag} label="Category" value={
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: `${item.category.color || "#818CF8"}20`,
              color: item.category.color || "#818CF8",
            }}>
              {item.category.name}
            </span>
          } />
        )}
        <InfoRow icon={Layers} label="Department" value={item.department || "—"} />
        <InfoRow icon={Receipt} label="Receipt" value={item.receipt ? "✓ Attached" : "No receipt"} color={item.receipt ? "rgba(34,197,94,0.15)" : undefined} />
        {item.isRecurring && (
          <InfoRow icon={Layers} label="Type" value={
            <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(99,102,241,0.15)", color: "#818CF8" }}>
              RECURRING
            </span>
          } />
        )}
        {item.source && <InfoRow icon={FileText} label="Source" value={item.source} />}
        {item.notes && (
          <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 10, border: "1px solid var(--border-color)" }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Notes</div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{item.notes}</p>
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

export function RevenueDetailDrawer({ open, onClose, item }: RevenueDrawerProps) {
  if (!item) return null;

  return (
    <DrawerShell open={open} onClose={onClose}>
      {/* Header */}
      <div style={{
        padding: "20px 24px", borderBottom: "1px solid var(--border-color)",
        background: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, transparent 60%)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Revenue Detail</div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {new Date(item.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </h3>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 8, padding: 8,
            cursor: "pointer", color: "var(--text-secondary)",
          }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Amount Card */}
      <div style={{ padding: "16px 24px" }}>
        <div style={{
          padding: 20, borderRadius: 12, background: "linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.03) 100%)",
          border: "1px solid rgba(34,197,94,0.15)", textAlign: "center",
        }}>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Amount</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#22C55E" }}>
            {formatCurrency(item.amount, item.currency)}
          </div>
        </div>
      </div>

      {/* Details */}
      <div style={{ padding: "0 24px 24px" }}>
        <InfoRow icon={Calendar} label="Month" value={new Date(item.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })} />
        <InfoRow icon={Tag} label="Type" value={
          <span style={{
            padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: item.type === "recurring" ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
            color: item.type === "recurring" ? "#22C55E" : "#F59E0B",
          }}>
            {item.type}
          </span>
        } />
        {item.category && (
          <InfoRow icon={Layers} label="Category" value={
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: "rgba(99,102,241,0.15)", color: "#818CF8",
            }}>
              {item.category}
            </span>
          } />
        )}
        <InfoRow icon={FileText} label="Source" value={item.source || "—"} />
        {item.client && (
          <InfoRow icon={Building2} label="Client" value={
            <div>
              <div style={{ fontWeight: 600 }}>{item.client.name}</div>
              {item.client.company && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{item.client.company}</div>}
            </div>
          } />
        )}
        {item.notes && (
          <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 10, border: "1px solid var(--border-color)" }}>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Notes</div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{item.notes}</p>
          </div>
        )}
      </div>
    </DrawerShell>
  );
}
