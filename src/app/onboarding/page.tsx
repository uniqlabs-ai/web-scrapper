"use client";

import { clientLog } from "@/lib/client-logger";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Mail,
  Upload,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Check,
  FileSpreadsheet,
  Loader2,
  ChevronRight,
} from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [transitioning, setTransitioning] = useState(false);

  // Step 2: Company
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState("LLP");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [saving, setSaving] = useState(false);
  const [orgCreated, setOrgCreated] = useState(false);

  // Step 3: Gmail
  const [gmailStatus, setGmailStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);

  // Step 4: Import
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);

  useEffect(() => {
    fetch("/api/integrations/gmail")
      .then((r) => r.json())
      .then((d) => {
        if (d.connected) {
          setGmailStatus("connected");
          setGmailEmail(d.email);
        }
      })
      .catch(() => {});
  }, []);

  const goTo = (s: Step) => {
    setTransitioning(true);
    setTimeout(() => {
      setStep(s);
      setTransitioning(false);
    }, 300);
  };

  const createOrg = async () => {
    if (!companyName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, companyType, gstin, pan, currency }),
      });
      if (res.ok) {
        setOrgCreated(true);
        setTimeout(() => goTo(3), 600);
      }
    } catch (e) { clientLog.warn("Non-critical error", "onboarding", "check-org", e); }
    setSaving(false);
  };

  const connectGmail = async () => {
    setGmailStatus("connecting");
    try {
      const res = await fetch("/api/integrations/gmail", { method: "POST" });
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch {
      setGmailStatus("disconnected");
    }
  };

  const handleFileUpload = async () => {
    if (!importFile) return;
    setImporting(true);
    const formData = new FormData();
    formData.append("file", importFile);
    formData.append("action", "import");
    formData.append("target", "expenses");
    formData.append("mapping", JSON.stringify({ description: "Description", amount: "Debit", date: "Txn Date" }));
    try {
      const res = await fetch("/api/import/csv", { method: "POST", body: formData });
      const data = await res.json();
      setImportResult({ imported: data.imported || 0 });
    } catch (e) { clientLog.warn("Non-critical error", "onboarding", "update-user", e); }
    setImporting(false);
  };

  const finishOnboarding = () => {
    localStorage.setItem("finance_show_tutorial", "true");
    router.push("/");
  };

  return (
    <div className="onboarding-page">
      {/* Animated background */}
      <div className="onboarding-bg">
        <div className="onboarding-orb onboarding-orb-1" />
        <div className="onboarding-orb onboarding-orb-2" />
        <div className="onboarding-orb onboarding-orb-3" />
      </div>

      {/* Progress dots */}
      <div className="onboarding-progress">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className={`progress-dot ${step >= s ? "active" : ""} ${step === s ? "current" : ""}`} />
        ))}
      </div>

      {/* Bubble Card */}
      <div className={`onboarding-bubble ${transitioning ? "slide-out" : "slide-in"}`}>
        {/* ── Step 1: Welcome ── */}
        {step === 1 && (
          <div className="bubble-content">
            <div className="bubble-icon-ring">
              <Sparkles size={40} />
            </div>
            <h1>Welcome to Finance OS</h1>
            <p className="bubble-subtitle">
              Set up your company finances in under 3 minutes.<br />
              Automate invoicing, track expenses, and stay GST-compliant.
            </p>
            <button className="bubble-btn primary" onClick={() => goTo(2)}>
              Get Started <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* ── Step 2: Company Profile ── */}
        {step === 2 && (
          <div className="bubble-content">
            <div className="bubble-icon-ring blue">
              <Building2 size={32} />
            </div>
            <h2>Your Company</h2>
            <p className="bubble-subtitle">Tell us about your business</p>

            <div className="bubble-form">
              <div className="bubble-field">
                <label>Company Name *</label>
                <input
                  type="text"
                  placeholder="e.g., uniQ Ventures LLP"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="bubble-field-row">
                <div className="bubble-field">
                  <label>Entity Type</label>
                  <select value={companyType} onChange={(e) => setCompanyType(e.target.value)}>
                    <option value="LLP">LLP</option>
                    <option value="Private Limited">Private Limited</option>
                    <option value="Sole Proprietorship">Sole Proprietorship</option>
                    <option value="Partnership">Partnership</option>
                    <option value="OPC">One Person Company</option>
                  </select>
                </div>
                <div className="bubble-field">
                  <label>Currency</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="INR">₹ INR</option>
                    <option value="USD">$ USD</option>
                    <option value="EUR">€ EUR</option>
                  </select>
                </div>
              </div>
              <div className="bubble-field-row">
                <div className="bubble-field">
                  <label>GSTIN</label>
                  <input type="text" placeholder="22AAAAA0000A1Z5" value={gstin} onChange={(e) => setGstin(e.target.value)} />
                </div>
                <div className="bubble-field">
                  <label>PAN</label>
                  <input type="text" placeholder="AAAAA1234A" value={pan} onChange={(e) => setPan(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="bubble-actions">
              <button className="bubble-btn ghost" onClick={() => goTo(1)}>
                <ArrowLeft size={16} /> Back
              </button>
              <button className="bubble-btn primary" onClick={createOrg} disabled={!companyName.trim() || saving}>
                {saving ? <Loader2 size={16} className="spin" /> : orgCreated ? <Check size={16} /> : null}
                {saving ? "Creating..." : orgCreated ? "Created!" : "Continue"}
                {!saving && !orgCreated && <ArrowRight size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Connect Gmail ── */}
        {step === 3 && (
          <div className="bubble-content">
            <div className="bubble-icon-ring green">
              <Mail size={32} />
            </div>
            <h2>Connect Gmail</h2>
            <p className="bubble-subtitle">
              Auto-import bank transaction alerts from ICICI, HDFC, Axis, SBI & more
            </p>

            <div className="gmail-card">
              {gmailStatus === "connected" ? (
                <div className="gmail-connected">
                  <Check size={20} className="check-icon" />
                  <div>
                    <strong>Connected</strong>
                    <span>{gmailEmail}</span>
                  </div>
                </div>
              ) : (
                <button className="gmail-connect-btn" onClick={connectGmail} disabled={gmailStatus === "connecting"}>
                  {gmailStatus === "connecting" ? (
                    <Loader2 size={18} className="spin" />
                  ) : (
                    <Mail size={18} />
                  )}
                  {gmailStatus === "connecting" ? "Connecting..." : "Connect Gmail Account"}
                </button>
              )}
            </div>

            <div className="bubble-actions">
              <button className="bubble-btn ghost" onClick={() => goTo(2)}>
                <ArrowLeft size={16} /> Back
              </button>
              <button className="bubble-btn primary" onClick={() => goTo(4)}>
                {gmailStatus === "connected" ? "Continue" : "Skip for now"} <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Import Financial History ── */}
        {step === 4 && (
          <div className="bubble-content">
            <div className="bubble-icon-ring purple">
              <Upload size={32} />
            </div>
            <h2>Import Financial History</h2>
            <p className="bubble-subtitle">
              Upload bank statements (CSV/PDF) or filed ITR documents to seed your data
            </p>

            <div className="import-options">
              <label className="import-drop-zone" htmlFor="onboarding-file">
                <FileSpreadsheet size={28} />
                {importFile ? (
                  <span className="file-name">{importFile.name}</span>
                ) : (
                  <>
                    <span>Drop your bank statement or ITR here</span>
                    <span className="hint">CSV, PDF — ICICI, HDFC, Axis, SBI formats supported</span>
                  </>
                )}
                <input
                  id="onboarding-file"
                  type="file"
                  accept=".csv,.pdf"
                  style={{ display: "none" }}
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
              </label>

              {importFile && !importResult && (
                <button className="bubble-btn outlined" onClick={handleFileUpload} disabled={importing}>
                  {importing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
                  {importing ? "Importing..." : "Import File"}
                </button>
              )}

              {importResult && (
                <div className="import-success">
                  <Check size={18} />
                  <span>{importResult.imported} records imported successfully</span>
                </div>
              )}
            </div>

            <div className="bubble-actions">
              <button className="bubble-btn ghost" onClick={() => goTo(3)}>
                <ArrowLeft size={16} /> Back
              </button>
              <button className="bubble-btn primary" onClick={() => goTo(5)}>
                {importResult ? "Continue" : "Skip for now"} <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Ready! ── */}
        {step === 5 && (
          <div className="bubble-content center">
            <div className="ready-animation">
              <div className="confetti-ring" />
              <div className="bubble-icon-ring gold">
                <Sparkles size={36} />
              </div>
            </div>
            <h1>You&apos;re All Set! <Sparkles size={24} style={{ display: "inline", verticalAlign: "middle", color: "#F59E0B" }} /></h1>
            <p className="bubble-subtitle">
              Your finance dashboard is ready. We&apos;ll guide you through each feature.
            </p>
            <button className="bubble-btn primary large" onClick={finishOnboarding}>
              Go to Dashboard <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        .onboarding-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          background: #06080f;
          font-family: 'Inter', -apple-system, sans-serif;
        }

        .onboarding-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
        }
        .onboarding-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          opacity: 0.4;
          animation: float 8s ease-in-out infinite;
        }
        .onboarding-orb-1 {
          width: 400px; height: 400px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          top: -100px; left: -100px;
        }
        .onboarding-orb-2 {
          width: 300px; height: 300px;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          bottom: -80px; right: -80px;
          animation-delay: -3s;
        }
        .onboarding-orb-3 {
          width: 200px; height: 200px;
          background: linear-gradient(135deg, #f59e0b, #ef4444);
          top: 50%; right: 20%;
          animation-delay: -5s;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-30px) scale(1.05); }
        }

        .onboarding-progress {
          position: fixed;
          top: 32px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 10px;
          z-index: 10;
        }
        .progress-dot {
          width: 10px; height: 10px;
          border-radius: 50%;
          background: rgba(255,255,255,0.15);
          transition: all 0.3s;
        }
        .progress-dot.active { background: rgba(99, 102, 241, 0.6); }
        .progress-dot.current {
          background: #6366f1;
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.6);
          transform: scale(1.2);
        }

        .onboarding-bubble {
          position: relative;
          z-index: 5;
          max-width: 540px;
          width: 90vw;
          background: rgba(15, 18, 30, 0.85);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 24px;
          padding: 48px 40px;
          box-shadow: 0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .onboarding-bubble.slide-in {
          animation: slideIn 0.35s ease-out;
        }
        .onboarding-bubble.slide-out {
          animation: slideOut 0.25s ease-in forwards;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes slideOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-10px) scale(0.98); }
        }

        .bubble-content { display: flex; flex-direction: column; align-items: center; }
        .bubble-content.center { text-align: center; }
        .bubble-icon-ring {
          width: 72px; height: 72px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15));
          border: 1px solid rgba(99,102,241,0.3);
          color: #a5b4fc;
          margin-bottom: 20px;
        }
        .bubble-icon-ring.blue {
          background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(6,182,212,0.15));
          border-color: rgba(59,130,246,0.3); color: #93c5fd;
        }
        .bubble-icon-ring.green {
          background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.15));
          border-color: rgba(34,197,94,0.3); color: #86efac;
        }
        .bubble-icon-ring.purple {
          background: linear-gradient(135deg, rgba(139,92,246,0.15), rgba(168,85,247,0.15));
          border-color: rgba(139,92,246,0.3); color: #c4b5fd;
        }
        .bubble-icon-ring.gold {
          background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(234,179,8,0.15));
          border-color: rgba(245,158,11,0.3); color: #fcd34d;
        }

        h1, h2 { color: #f1f5f9; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.02em; }
        h1 { font-size: 28px; }
        h2 { font-size: 22px; }
        .bubble-subtitle {
          color: #94a3b8; font-size: 14px; line-height: 1.6; text-align: center;
          margin: 0 0 28px; max-width: 400px;
        }

        .bubble-form { width: 100%; margin-bottom: 24px; }
        .bubble-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .bubble-field label { font-size: 12px; color: #94a3b8; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
        .bubble-field input, .bubble-field select {
          padding: 10px 14px; border-radius: 10px; font-size: 14px; color: #f1f5f9;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
          outline: none; transition: border-color 0.2s;
        }
        .bubble-field input:focus, .bubble-field select:focus { border-color: rgba(99,102,241,0.5); }
        .bubble-field input::placeholder { color: #475569; }
        .bubble-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        .bubble-actions { display: flex; justify-content: space-between; width: 100%; margin-top: 8px; }
        .bubble-btn {
          display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px;
          border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer;
          border: none; transition: all 0.2s;
        }
        .bubble-btn.primary {
          background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white;
          box-shadow: 0 4px 20px rgba(99,102,241,0.3);
        }
        .bubble-btn.primary:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(99,102,241,0.4); }
        .bubble-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .bubble-btn.primary.large { padding: 16px 36px; font-size: 16px; border-radius: 14px; }
        .bubble-btn.ghost { background: transparent; color: #94a3b8; padding: 12px 16px; }
        .bubble-btn.ghost:hover { color: #f1f5f9; }
        .bubble-btn.outlined {
          background: transparent; color: #a5b4fc;
          border: 1px solid rgba(99,102,241,0.3); margin-top: 12px;
        }
        .bubble-btn.outlined:hover { background: rgba(99,102,241,0.1); }

        .gmail-card {
          width: 100%; padding: 20px; border-radius: 14px; margin-bottom: 24px;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
        }
        .gmail-connect-btn {
          display: flex; align-items: center; gap: 10px; width: 100%; padding: 14px 20px;
          border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer;
          background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #86efac;
          transition: all 0.2s;
        }
        .gmail-connect-btn:hover { background: rgba(34,197,94,0.15); }
        .gmail-connect-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .gmail-connected {
          display: flex; align-items: center; gap: 12px;
        }
        .gmail-connected .check-icon { color: #22c55e; }
        .gmail-connected strong { display: block; color: #f1f5f9; font-size: 14px; }
        .gmail-connected span { color: #94a3b8; font-size: 12px; }

        .import-options { width: 100%; margin-bottom: 24px; display: flex; flex-direction: column; align-items: center; }
        .import-drop-zone {
          width: 100%; padding: 32px 20px; border-radius: 14px;
          border: 2px dashed rgba(139,92,246,0.3); background: rgba(139,92,246,0.05);
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          cursor: pointer; transition: all 0.2s; color: #c4b5fd; text-align: center;
        }
        .import-drop-zone:hover { border-color: rgba(139,92,246,0.5); background: rgba(139,92,246,0.08); }
        .import-drop-zone span { font-size: 13px; color: #94a3b8; }
        .import-drop-zone .hint { font-size: 11px; color: #64748b; }
        .import-drop-zone .file-name { font-size: 14px; color: #a5b4fc; font-weight: 600; }

        .import-success {
          display: flex; align-items: center; gap: 8px; margin-top: 12px;
          padding: 10px 16px; border-radius: 10px;
          background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #86efac; font-size: 13px;
        }

        .ready-animation { position: relative; margin-bottom: 8px; }
        .confetti-ring {
          position: absolute; inset: -16px; border-radius: 50%;
          border: 2px solid rgba(245,158,11,0.3);
          animation: pulse-ring 1.5s ease-in-out infinite;
        }
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.15); opacity: 0.6; }
        }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
