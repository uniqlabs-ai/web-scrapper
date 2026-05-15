"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Map, FileText, TrendingUp, Building2, GitMerge, AlertTriangle, Users, Inbox, Heart, Target, Calculator } from "lucide-react";

import { useToast } from "@/components/toast";

interface Command {
  id: string;
  name: string;
  href?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  shortcut?: string;
  action?: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadingAI, setLoadingAI] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const COMMANDS: Command[] = [
    // Navigation
    { id: "dashboard", name: "Go to Dashboard", href: "/", icon: Map },
    { id: "health", name: "Financial Health Score", href: "/health", icon: Heart },
    { id: "metrics", name: "SaaS Metrics", href: "/saas-metrics", icon: Target },
    { id: "invoices", name: "Go to Invoices", href: "/invoices", icon: FileText },
    { id: "new_invoice", name: "Create New Invoice", href: "/invoices?new=1", icon: FileText, shortcut: "I" },
    { id: "expenses", name: "Go to Expenses", href: "/expenses", icon: TrendingUp },
    { id: "new_expense", name: "Log New Expense", href: "/expenses?new=1", icon: TrendingUp, shortcut: "E" },
    { id: "ap_inbox", name: "Go to A/P Inbox", href: "/ap-inbox", icon: Inbox },
    { id: "bank", name: "Go to Bank Feeds", href: "/bank", icon: Building2 },
    { id: "recon", name: "Go to Reconciliation", href: "/reconciliation", icon: GitMerge },
    { id: "team", name: "Go to Team Directory", href: "/team", icon: Users },
    { id: "reports", name: "Accounting Reports", href: "/reports", icon: Calculator },
    { id: "anomalies", name: "View Anomalies", href: "/anomalies", icon: AlertTriangle },
    { id: "settings", name: "Go to Settings", href: "/settings", icon: Map },
    // Actions
    {
      id: "scan_anomalies",
      name: "Scan for Spending Anomalies",
      icon: AlertTriangle,
      action: async () => {
        toast("Scanning patterns...", "info");
        await fetch("/api/anomalies");
        toast("Anomaly scan complete.", "success");
      }
    },
    {
      id: "run_recon",
      name: "Run AI Auto-Reconciliation",
      icon: GitMerge,
      action: async () => {
        toast("Running auto-reconciliation...", "info");
        await fetch("/api/reconciliation/auto-match", { method: "POST" });
        toast("Auto-reconciliation complete.", "success");
      }
    },
    {
      id: "cfo_brief",
      name: "Generate & Send Weekly CFO Brief",
      icon: FileText,
      action: async () => {
        toast("Generating CFO brief...", "info");
        await fetch("/api/cfo-brief", { method: "POST" });
        toast("CFO brief generated and sent.", "success");
      }
    }
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD+K or CTRL+K
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    
    // Listen for custom trigger from sidebar
    const handleCustomTrigger = () => setOpen(true);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-command-palette", handleCustomTrigger);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-command-palette", handleCustomTrigger);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setSearch("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  const handleSelect = (cmd: Command) => {
    setOpen(false);
    if (cmd.action) {
      cmd.action();
    } else if (cmd.href) {
      router.push(cmd.href);
    }
  };

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0) {
        handleSelect(filtered[activeIndex]);
      } else if (search.trim()) {
        // AI Command Shortcut trigger
        setLoadingAI(true);
        toast("Processing command via Copilot...", "info", 3000);
        try {
          const res = await fetch("/api/copilot/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: search.trim() }),
          });
          const data = await res.json();
          if (res.ok) {
            toast(data.response?.substring(0, 100) + "...", "success", 5000);
            if (data.action && data.action.url) router.push(data.action.url);
          } else {
            toast(data.error || "Command failed", "error");
          }
        } catch {
          toast("Network error executing AI command", "error");
        }
        setLoadingAI(false);
        setOpen(false);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-modal" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-header">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="cmd-input"
            placeholder="Type a command or search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={true}
            aria-controls="cmd-results-list"
            aria-activedescendant={filtered[activeIndex] ? `cmd-item-${filtered[activeIndex].id}` : undefined}
            aria-autocomplete="list"
            aria-label="Search commands"
          />
        </div>
        <div className="cmd-results" id="cmd-results-list" role="listbox" aria-label="Command results">
          {filtered.length === 0 ? (
            <div className="cmd-empty">
              {loadingAI ? "Processing AI Command..." : `Press Enter to execute "${search}" via AI`}
            </div>
          ) : (
            filtered.map((cmd, i) => {
              const isActive = i === activeIndex;
              return (
                <div
                  key={cmd.id}
                  id={`cmd-item-${cmd.id}`}
                  className={`cmd-item ${isActive ? "active" : ""}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => handleSelect(cmd)}
                >
                  <cmd.icon size={14} className="cmd-item-icon" aria-hidden="true" />
                  <span>{cmd.name}</span>
                  {cmd.shortcut && <span className="cmd-shortcut">{cmd.shortcut}</span>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
