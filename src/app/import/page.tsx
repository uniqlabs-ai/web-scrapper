"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  Download,
  Loader2,
  FileText,
  Receipt,
  Building2,
  BarChart3,
  Clock,
  History,
  Copy,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { PageHeader } from "@/components/page-header";

interface ImportedFile {
  id: string;
  name: string;
  status: "uploading" | "detecting" | "importing" | "done" | "error" | "duplicate";
  detectedType: string | null;
  label: string | null;
  summary: string | null;
  imported: number;
  error: string | null;
  // Duplicate invoice info
  duplicateInfo?: {
    existingInvoice: {
      id: string;
      invoiceNumber: string;
      client: string | null;
      total: number;
      currency: string;
      issueDate: string;
      status: string;
    };
    parsed: {
      invoiceNumber: string;
      client: string | null;
      total: number;
      currency: string;
    };
  };
  // Store original file for re-import
  originalFile?: File;
}

const TYPE_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  invoice: { icon: <Receipt size={16} />, color: "#6366F1" },
  bank_statement: { icon: <Building2 size={16} />, color: "#22C55E" },
  financial_statement: { icon: <BarChart3 size={16} />, color: "#F59E0B" },
  csv: { icon: <FileSpreadsheet size={16} />, color: "#8B5CF6" },
  unknown: { icon: <FileText size={16} />, color: "#6B7280" },
};

export default function ImportPage() {
  const { toast } = useToast();
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<Array<{
    id: string; type: string; fileName: string; rowCount: number;
    status: string; createdAt: string; columnMapping: string | null;
  }>>([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/import/history");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.batches || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function processFile(file: File, forceImport = false) {
    const fileId = forceImport
      // eslint-disable-next-line react-hooks/purity
      ? files.find((f) => f.originalFile === file)?.id || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      // eslint-disable-next-line react-hooks/purity
      : `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    if (forceImport) {
      // Update existing entry to re-importing state
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, status: "importing", error: null, duplicateInfo: undefined } : f
        )
      );
    } else {
      const entry: ImportedFile = {
        id: fileId,
        name: file.name,
        status: "detecting",
        detectedType: null,
        label: null,
        summary: null,
        imported: 0,
        error: null,
        originalFile: file,
      };
      setFiles((prev) => [entry, ...prev]);
    }

    try {
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, status: "importing" } : f))
      );

      const formData = new FormData();
      formData.append("file", file);
      if (forceImport) {
        formData.append("forceImport", "true");
      }

      const res = await fetch("/api/import/smart", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      // Handle duplicate invoice
      if (data.duplicate) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  status: "duplicate",
                  detectedType: data.detectedType || "invoice",
                  label: data.label,
                  summary: data.summary,
                  error: data.error,
                  duplicateInfo: {
                    existingInvoice: data.existingInvoice,
                    parsed: data.parsed,
                  },
                  originalFile: file,
                }
              : f
          )
        );
        return;
      }

      if (!res.ok || !data.success) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  status: "error",
                  detectedType: data.detectedType || "unknown",
                  error: data.error || "Import failed",
                }
              : f
          )
        );
        return;
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                status: "done",
                detectedType: data.detectedType,
                label: data.label,
                summary: data.summary,
                imported: data.imported || 0,
              }
            : f
        )
      );

      toast(`${data.label}: ${data.imported} items imported`, "success");
      loadHistory();
    } catch (err) {
      clientLog.error("Failed to import data", "import", "process", err);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, status: "error", error: "Upload failed" }
            : f
        )
      );
    }
  }

  async function handleForceImport(fileEntry: ImportedFile) {
    if (!fileEntry.originalFile) {
      toast("Cannot re-import: original file not available", "error");
      return;
    }
    await processFile(fileEntry.originalFile, true);
  }

  async function handleFiles(selectedFiles: FileList | File[]) {
    const fileArray = Array.from(selectedFiles);
    await Promise.allSettled(fileArray.map((f) => processFile(f)));
  }

  function clearFiles() {
    setFiles([]);
  }

  const totalImported = files.reduce((sum, f) => sum + f.imported, 0);
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const duplicateCount = files.filter((f) => f.status === "duplicate").length;
  const processingCount = files.filter((f) =>
    ["uploading", "detecting", "importing"].includes(f.status)
  ).length;

  return (
    <div className="page-container">
      <PageHeader title="Smart Import" description="Drop any financial document — invoices, bank statements, balance sheets — and we'll figure out the rest">
        {files.length > 0 && (
          <button className="btn btn-secondary" onClick={clearFiles} style={{ fontSize: 13 }}>
            <X size={14} /> Clear All
          </button>
        )}
      </PageHeader>

      {/* Auto-detection badges */}
      <div style={{
        display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap",
      }}>
        {[
          { label: "Invoices", type: "invoice", desc: "Tax & service invoices" },
          { label: "Bank Statements", type: "bank_statement", desc: "ICICI, Axis, etc." },
          { label: "Financial Statements", type: "financial_statement", desc: "P&L, balance sheets" },
          { label: "CSV Exports", type: "csv", desc: "Tally, Zoho, QuickBooks" },
        ].map((item) => {
          const { icon, color } = TYPE_ICONS[item.type] || TYPE_ICONS.unknown;
          return (
            <div
              key={item.type}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px", borderRadius: 8,
                background: `${color}10`, border: `1px solid ${color}25`,
                fontSize: 12, color: "var(--text-secondary)",
              }}
            >
              <span style={{ color }}>{icon}</span>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{item.label}</span>
              <span>·</span>
              <span>{item.desc}</span>
            </div>
          );
        })}
      </div>

      {/* Drop zone */}
      <div
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onClick={() => fileInputRef.current?.click()}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "48px 40px",
          border: `2px dashed ${dragActive ? "var(--accent-primary)" : "var(--border-color)"}`,
          borderRadius: 16,
          background: dragActive ? "rgba(99, 102, 241, 0.05)" : "var(--bg-card)",
          cursor: "pointer",
          transition: "all 0.2s ease",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #6366F1, #A855F7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {processingCount > 0 ? (
            <Loader2 size={24} color="white" style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <Upload size={24} color="white" />
          )}
        </div>
        <div style={{ textAlign: "center" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 600, color: "var(--text-primary)" }}>
            {processingCount > 0
              ? `Processing ${processingCount} file${processingCount > 1 ? "s" : ""}...`
              : "Drop files here or click to upload"}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
            <Sparkles size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            AI auto-detects: invoices, bank statements, P&L, balance sheets, CSV exports
          </p>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.pdf"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFiles(e.target.files);
          }
          e.target.value = "";
        }}
      />

      {/* Summary KPIs */}
      {files.length > 0 && (
        <div className="kpi-grid" style={{ gridTemplateColumns: `repeat(${duplicateCount > 0 ? 4 : 3}, 1fr)`, marginBottom: 20 }}>
          <div className="kpi-card green">
            <div className="kpi-label"><CheckCircle2 size={14} color="#22C55E" /> Imported</div>
            <div className="kpi-value" style={{ color: "#22C55E" }}>{totalImported}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label"><FileText size={14} /> Files Processed</div>
            <div className="kpi-value">{doneCount} / {files.length}</div>
          </div>
          {duplicateCount > 0 && (
            <div className="kpi-card">
              <div className="kpi-label"><Copy size={14} color="#F59E0B" /> Duplicates</div>
              <div className="kpi-value" style={{ color: "#F59E0B" }}>{duplicateCount}</div>
            </div>
          )}
          {errorCount > 0 && (
            <div className="kpi-card">
              <div className="kpi-label"><AlertTriangle size={14} color="#F43F5E" /> Errors</div>
              <div className="kpi-value" style={{ color: "#F43F5E" }}>{errorCount}</div>
            </div>
          )}
        </div>
      )}

      {/* Per-file status cards */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {files.map((f) => {
            const typeInfo = TYPE_ICONS[f.detectedType || "unknown"] || TYPE_ICONS.unknown;
            return (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  background: "var(--bg-card)",
                  borderRadius: 10,
                  border: `1px solid ${
                    f.status === "done"
                      ? "rgba(34,197,94,0.2)"
                      : f.status === "error"
                        ? "rgba(239,68,68,0.2)"
                        : f.status === "duplicate"
                          ? "rgba(245,158,11,0.3)"
                          : "var(--border-color)"
                  }`,
                  overflow: "hidden",
                }}
              >
                {/* Main row */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 16px",
                }}>
                  {/* Status icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: f.status === "done"
                      ? `${typeInfo.color}15`
                      : f.status === "error"
                        ? "rgba(239,68,68,0.1)"
                        : f.status === "duplicate"
                          ? "rgba(245,158,11,0.1)"
                          : "rgba(99,102,241,0.1)",
                  }}>
                    {f.status === "importing" || f.status === "detecting" || f.status === "uploading" ? (
                      <Loader2 size={18} style={{ animation: "spin 1s linear infinite", color: "#6366F1" }} />
                    ) : f.status === "error" ? (
                      <AlertTriangle size={18} color="#F43F5E" />
                    ) : f.status === "duplicate" ? (
                      <Copy size={18} color="#F59E0B" />
                    ) : f.status === "done" ? (
                      <span style={{ color: typeInfo.color }}>{typeInfo.icon}</span>
                    ) : (
                      <FileText size={18} color="#6B7280" />
                    )}
                  </div>

                  {/* File info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</span>
                      {f.label && (
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: `${typeInfo.color}15`, color: typeInfo.color,
                          textTransform: "uppercase", letterSpacing: 0.5,
                        }}>
                          {f.label}
                        </span>
                      )}
                      {f.status === "duplicate" && (
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: "rgba(245,158,11,0.15)", color: "#F59E0B",
                          textTransform: "uppercase", letterSpacing: 0.5,
                        }}>
                          DUPLICATE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {f.status === "detecting" && "Detecting document type..."}
                      {f.status === "uploading" && "Uploading..."}
                      {f.status === "importing" && "Parsing and importing..."}
                      {f.status === "done" && f.summary}
                      {f.status === "duplicate" && (
                        <span style={{ color: "#F59E0B" }}>{f.error}</span>
                      )}
                      {f.status === "error" && (
                        <span style={{ color: "#F43F5E" }}>{f.error}</span>
                      )}
                    </div>
                  </div>

                  {/* Imported count */}
                  {f.status === "done" && f.imported > 0 && (
                    <div style={{
                      padding: "4px 10px", borderRadius: 6,
                      background: "rgba(34,197,94,0.1)", color: "#22C55E",
                      fontWeight: 700, fontSize: 13,
                    }}>
                      {f.imported} imported
                    </div>
                  )}

                  {/* Remove */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFiles((prev) => prev.filter((x) => x.id !== f.id));
                    }}
                    style={{
                      background: "none", border: "none",
                      color: "var(--text-tertiary)", cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Duplicate action row */}
                {f.status === "duplicate" && f.duplicateInfo && (
                  <div style={{
                    padding: "12px 16px",
                    borderTop: "1px solid rgba(245,158,11,0.15)",
                    background: "rgba(245,158,11,0.04)",
                  }}>
                    <div style={{
                      display: "flex", gap: 16, alignItems: "flex-start",
                      fontSize: 12, color: "var(--text-secondary)",
                      marginBottom: 12,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Existing Invoice
                        </div>
                        <div>{f.duplicateInfo.existingInvoice.invoiceNumber}</div>
                        <div>{f.duplicateInfo.existingInvoice.client || "Unknown client"}</div>
                        <div>{f.duplicateInfo.existingInvoice.currency} {f.duplicateInfo.existingInvoice.total.toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                          Status: {f.duplicateInfo.existingInvoice.status}
                        </div>
                      </div>
                      <div style={{
                        width: 1, height: 60, background: "var(--border-color)",
                        alignSelf: "center",
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          New Invoice (from PDF)
                        </div>
                        <div>{f.duplicateInfo.parsed.invoiceNumber}</div>
                        <div>{f.duplicateInfo.parsed.client || "Unknown client"}</div>
                        <div>{f.duplicateInfo.parsed.currency} {f.duplicateInfo.parsed.total.toLocaleString()}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleForceImport(f)}
                        style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <RefreshCw size={12} />
                        Import with New Reference
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                        style={{ fontSize: 12, padding: "6px 14px" }}
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Import History */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{
          fontSize: 15, fontWeight: 600, color: "var(--text-primary)",
          display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
        }}>
          <History size={16} /> Import History
        </h3>
        {history.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 32,
            color: "var(--text-tertiary)", fontSize: 13,
            background: "var(--bg-card)", borderRadius: 10,
            border: "1px solid var(--border-color)",
          }}>
            No imports yet. Upload files above to get started.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((batch) => {
              const typeInfo = TYPE_ICONS[batch.type] || TYPE_ICONS.unknown;
              let meta: { detectedType?: string; summary?: string } = {};
              try { meta = batch.columnMapping ? JSON.parse(batch.columnMapping) : {}; } catch (e) { console.warn("[Import] Non-critical error:", e instanceof Error ? e.message : String(e)); }
              return (
                <div key={batch.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", background: "var(--bg-card)",
                  borderRadius: 8, border: "1px solid var(--border-color)",
                  fontSize: 13,
                }}>
                  <span style={{ color: typeInfo.color }}>{typeInfo.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{batch.fileName}</div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                      {meta.summary || batch.type}
                    </div>
                  </div>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 10,
                    fontWeight: 700, textTransform: "uppercase" as const,
                    background: `${typeInfo.color}15`, color: typeInfo.color,
                  }}>
                    {(meta.detectedType || batch.type).replace("_", " ")}
                  </span>
                  <span style={{ fontWeight: 600, color: "#22C55E", fontSize: 12 }}>
                    {batch.rowCount} items
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock size={11} />
                    {new Date(batch.createdAt).toLocaleDateString("en-IN", {
                      day: "2-digit", month: "short", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
