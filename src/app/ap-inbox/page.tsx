/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect } from "react";
import { Inbox, CheckCircle, XCircle, Mail, Camera, FileText } from "lucide-react";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/currency";
import { StaggerContainer, SlideUp, FadeIn } from "@/components/animations";
import { PageHeader } from "@/components/page-header";

interface InboxItem {
  approvalId: string;
  expenseId: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  vendor: string;
  category: string;
  receipt?: {
    id: string;
    fileName: string;
    imageData: string;
    confidence: number;
    extraction: Record<string, unknown>;
  } | null;
  comments: string;
  submittedAt: string;
}

export default function APInboxPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);

  // Editable fields for the selected item
  const [editAmount, setEditAmount] = useState<string>("");
  const [editVendor, setEditVendor] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { loadInbox(); }, []);

  async function loadInbox() {
    setLoading(true);
    try {
      const res = await fetch("/api/ap-inbox");
      const data = await res.json();
      setItems(data.inbox || []);
      if (!selectedItem && data.inbox?.length > 0) {
        selectItem(data.inbox[0]);
      }
    } catch {
      toast("Failed to load generic inbox", "error");
    }
    setLoading(false);
  }

  function selectItem(item: InboxItem) {
    setSelectedItem(item);
    setEditAmount(item.amount.toString());
    setEditVendor(item.vendor || "");
    setEditCategory(item.category || "Software");
  }

  async function handleAction(action: "approve" | "reject") {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/ap-inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: selectedItem.approvalId,
          action,
          finalAmount: Number(editAmount),
          finalVendor: editVendor,
          finalCategory: editCategory,
        })
      });

      const data = await res.json();
      if (!res.ok) { toast(data.error || "Failed action", "error"); }
      else {
        toast(data.message, "success");
        setItems(prev => prev.filter(i => i.approvalId !== selectedItem.approvalId));
        setSelectedItem(null);
        // Automatically select next
        const remaining = items.filter(i => i.approvalId !== selectedItem.approvalId);
        if (remaining.length > 0) selectItem(remaining[0]);
      }
    } catch {
      toast("Error processing action.", "error");
    }
    setActionLoading(false);
  }

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", height: "calc(100vh - 40px)" }}>
      {/* Header */}
      <SlideUp delay={0.1}>
        <PageHeader 
          title="Accounts Payable Inbox" 
          description="Review, correct, and approve AI-scanned vendor invoices received via email." 
        />
      </SlideUp>

      <StaggerContainer delay={0.15} style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
        {/* Left Sidebar - Inbox List */}
        <SlideUp delay={0.2} className="responsive-modal" style={{ width: 380, backgroundColor: "#111827", borderRadius: 12, border: "1px solid #1F2937", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: 16, borderBottom: "1px solid #1F2937", backgroundColor: "#1F2937" }}>
             <h3 style={{ margin: 0, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}><Mail size={16} /> Pending Review ({items.length})</h3>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: "center", color: "#6B7280" }}>Syncing emails...</div>
            ) : items.length === 0 ? (
              <FadeIn delay={0.3} style={{ padding: 40, textAlign: "center" }}>
                <CheckCircle size={40} style={{ color: "#10B981", margin: "0 auto 16px", opacity: 0.8 }} />
                <div style={{ color: "#D1D5DB", fontWeight: 600 }}>Inbox Zero!</div>
                <div style={{ color: "#6B7280", fontSize: 13, marginTop: 4 }}>All bills are processed.</div>
              </FadeIn>
            ) : (
              items.map((item, idx) => (
                <SlideUp delay={idx * 0.05} key={item.approvalId}>
                   <div 
                     onClick={() => selectItem(item)}
                     style={{
                       padding: "16px",
                       borderBottom: "1px solid #1F2937",
                       cursor: "pointer",
                       backgroundColor: selectedItem?.approvalId === item.approvalId ? "rgba(99,102,241,0.1)" : "transparent",
                       borderLeft: selectedItem?.approvalId === item.approvalId ? "3px solid #6366F1" : "3px solid transparent",
                       transition: "all 0.2s"
                     }}
                   >
                     <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{item.vendor || "Unknown Vendor"}</div>
                        <div style={{ fontWeight: 700, color: "#10B981" }}>{formatCurrency(item.amount)}</div>
                     </div>
                     <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.description}
                     </div>
                     <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6B7280" }}>
                        <span>{new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4, color: item.receipt?.confidence && item.receipt.confidence > 0.8 ? "#10B981" : "#F59E0B" }}>
                          <Camera size={12}/> {(item.receipt?.confidence || 0) * 100}% Match
                        </span>
                     </div>
                   </div>
                </SlideUp>
              ))
            )}
          </div>
        </SlideUp>

        {/* Right Side - Review Pane */}
        {selectedItem ? (
           <SlideUp delay={0.3} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24, overflowY: "auto", minHeight: 0 }}>
              
              {/* Splitted Top Row: Verification Form & Actions */}
              <div style={{ backgroundColor: "#1F2937", padding: 24, borderRadius: 12 }}>
                 <div style={{ display: "flex", gap: 24 }}>
                    <div style={{ flex: 1.5 }}>
                       <h3 style={{ margin: "0 0 16px", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                          <FileText size={18} color="#6366F1" /> Verification Engine
                       </h3>
                       <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                          <div>
                            <label style={{ fontSize: 12, color: "#9CA3AF", display: "block", marginBottom: 6 }}>Extracted Vendor</label>
                            <input value={editVendor} onChange={e => setEditVendor(e.target.value)} style={{ width: "100%", padding: "10px", background: "#111827", border: "1px solid #374151", borderRadius: 6, color: "#fff", fontSize: 14 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 12, color: "#9CA3AF", display: "block", marginBottom: 6 }}>Final Amount (INR)</label>
                            <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} style={{ width: "100%", padding: "10px", background: "#111827", border: "1px solid #374151", borderRadius: 6, color: "#10B981", fontWeight: 700, fontSize: 14 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 12, color: "#9CA3AF", display: "block", marginBottom: 6 }}>Category Mapping</label>
                            <select value={editCategory} onChange={e => setEditCategory(e.target.value)} style={{ width: "100%", padding: "10px", background: "#111827", border: "1px solid #374151", borderRadius: 6, color: "#fff", fontSize: 14 }}>
                               <option value="Software">Software</option>
                               <option value="Infrastructure">Infrastructure</option>
                               <option value="Office Supplies">Office Supplies</option>
                               <option value="Travel">Travel</option>
                               <option value="Marketing">Marketing</option>
                               <option value="Miscellaneous">Miscellaneous</option>
                            </select>
                          </div>
                       </div>
                    </div>

                    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", borderLeft: "1px solid #374151", paddingLeft: 24 }}>
                        <button 
                          onClick={() => handleAction("approve")} 
                          disabled={actionLoading}
                          style={{ width: "100%", padding: "14px", backgroundColor: "#10B981", color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}
                        >
                          <CheckCircle size={18} /> Approve & Log to Ledger
                        </button>
                        <button 
                          onClick={() => handleAction("reject")} 
                          disabled={actionLoading}
                          style={{ width: "100%", padding: "14px", backgroundColor: "transparent", color: "#EF4444", border: "1px solid #EF4444", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                        >
                          <XCircle size={18} /> Reject
                        </button>
                    </div>
                 </div>
              </div>

              {/* Source Receipt Display */}
              <div style={{ flex: 1, backgroundColor: "#111827", borderRadius: 12, border: "1px solid #1F2937", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                 <div style={{ padding: "12px 16px", backgroundColor: "#1F2937", borderBottom: "1px solid #374151", display: "flex", justifyContent: "space-between" }}>
                   <span style={{ fontSize: 13, fontWeight: 600 }}>Source Receipt: {selectedItem.receipt?.fileName || "Attachment.pdf"}</span>
                   <span style={{ fontSize: 12, color: "#9CA3AF" }}>Via Email Alias</span>
                 </div>
                 <div style={{ flex: 1, padding: 24, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
                   {selectedItem.receipt?.imageData ? (
                     <img src={`data:image/jpeg;base64,${selectedItem.receipt.imageData}`} alt="Scanned receipt document" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }} />
                   ) : (
                     <div style={{ color: "#6B7280" }}>No Image Preview Available</div>
                   )}
                 </div>
              </div>

           </SlideUp>
        ) : (
           <SlideUp delay={0.3} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#111827", borderRadius: 12, border: "1px solid #1F2937" }}>
              <div style={{ textAlign: "center", color: "#6B7280" }}>
                 <FileText size={48} style={{ margin: "0 auto 16px", opacity: 0.5 }} />
                 <p style={{ fontSize: 16 }}>Select an inbox item to review</p>
              </div>
           </SlideUp>
        )}
      </StaggerContainer>
    </div>
  );
}
