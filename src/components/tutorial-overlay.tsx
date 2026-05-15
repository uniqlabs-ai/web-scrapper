"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

interface TutorialStep {
  target: string; // href of the sidebar item
  title: string;
  description: string;
  position: "right" | "bottom";
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: "/",
    title: "Dashboard",
    description: "Your financial command center. See KPIs, runway, and cash flow at a glance.",
    position: "right",
  },
  {
    target: "/health",
    title: "Health Score",
    description: "AI-powered financial health analysis with actionable recommendations.",
    position: "right",
  },
  {
    target: "/invoices",
    title: "Invoices",
    description: "Create GST-compliant invoices, track payments, and send reminders automatically.",
    position: "right",
  },
  {
    target: "/expenses",
    title: "Expenses",
    description: "Log expenses, attach receipts, and let AI categorize them for you.",
    position: "right",
  },
  {
    target: "/bank",
    title: "Bank",
    description: "View synced bank transactions from Gmail alerts and imported statements.",
    position: "right",
  },
  {
    target: "/import",
    title: "Import",
    description: "Bulk import data from CSV/PDF bank statements into your ledger.",
    position: "right",
  },
  {
    target: "/reconciliation",
    title: "Reconcile",
    description: "Auto-match bank transactions to invoices and expenses for clean books.",
    position: "right",
  },
  {
    target: "/gst",
    title: "GST Returns",
    description: "Auto-generated GSTR-1 and GSTR-3B summaries ready for filing.",
    position: "right",
  },
];

export default function TutorialOverlay() {
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const shouldShow = localStorage.getItem("finance_show_tutorial");
    const completed = localStorage.getItem("finance_tutorial_completed");
    if (shouldShow === "true" && !completed) {
      setTimeout(() => setVisible(true), 800);
    }
  }, []);

  const updateHighlight = useCallback(() => {
    const step = TUTORIAL_STEPS[currentStep];
    if (!step) return;

    const sidebarLink = document.querySelector(`a[href="${step.target}"]`);
    if (sidebarLink) {
      const rect = sidebarLink.getBoundingClientRect();
      setHighlightRect(rect);
    }
  }, [currentStep]);

  useEffect(() => {
    if (visible) {
      updateHighlight();
      window.addEventListener("resize", updateHighlight);
      return () => window.removeEventListener("resize", updateHighlight);
    }
  }, [visible, currentStep, updateHighlight]);

  const next = () => {
    if (currentStep < TUTORIAL_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      finish();
    }
  };

  const prev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const finish = () => {
    setVisible(false);
    localStorage.setItem("finance_tutorial_completed", "true");
    localStorage.removeItem("finance_show_tutorial");
  };

  if (!visible) return null;

  const step = TUTORIAL_STEPS[currentStep];

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 9998,
          transition: "opacity 0.3s",
        }}
      />

      {/* Highlight ring */}
      {highlightRect && (
        <div
          style={{
            position: "fixed",
            top: highlightRect.top - 4,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
            borderRadius: 10,
            border: "2px solid rgba(99, 102, 241, 0.8)",
            boxShadow: "0 0 0 4px rgba(99, 102, 241, 0.2), 0 0 20px rgba(99, 102, 241, 0.3)",
            zIndex: 9999,
            pointerEvents: "none",
            transition: "all 0.4s ease",
            animation: "tutorial-pulse 2s ease-in-out infinite",
          }}
        />
      )}

      {/* Tooltip bubble */}
      {highlightRect && (
        <div
          style={{
            position: "fixed",
            top: highlightRect.top + highlightRect.height / 2 - 60,
            left: highlightRect.right + 20,
            zIndex: 10000,
            maxWidth: 320,
            transition: "all 0.4s ease",
          }}
        >
          <div
            style={{
              background: "rgba(15, 18, 30, 0.95)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(99, 102, 241, 0.25)",
              borderRadius: 16,
              padding: "20px 24px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
              position: "relative",
            }}
          >
            {/* Arrow pointer */}
            <div
              style={{
                position: "absolute",
                left: -8,
                top: 28,
                width: 16,
                height: 16,
                background: "rgba(15, 18, 30, 0.95)",
                border: "1px solid rgba(99, 102, 241, 0.25)",
                borderRight: "none",
                borderTop: "none",
                transform: "rotate(45deg)",
              }}
            />

            {/* Close */}
            <button
              onClick={finish}
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                background: "none",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                padding: 4,
              }}
            >
              <X size={14} />
            </button>

            {/* Content */}
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>
              {step.title}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, marginBottom: 16 }}>
              {step.description}
            </div>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#475569" }}>
                {currentStep + 1} / {TUTORIAL_STEPS.length}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {currentStep > 0 && (
                  <button
                    onClick={prev}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 12px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      background: "transparent",
                      color: "#94a3b8",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <ChevronLeft size={14} /> Back
                  </button>
                )}
                <button
                  onClick={next}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 16px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {currentStep < TUTORIAL_STEPS.length - 1 ? (
                    <>
                      Next <ChevronRight size={14} />
                    </>
                  ) : (
                    "Finish"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes tutorial-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.2), 0 0 20px rgba(99, 102, 241, 0.3); }
          50% { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0.1), 0 0 30px rgba(99, 102, 241, 0.4); }
        }
      `}</style>
    </>
  );
}
