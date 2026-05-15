/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Providers from "./providers";
import "./globals.css";
import {
  LayoutDashboard,
  FileText,
  CreditCard,
  TrendingUp,
  BarChart3,
  Settings,
  Menu,
  X,
  Wallet,
  LogOut,
  Building2,
  Download,
  Target,
  Store,
  Repeat,
  GitMerge,
  Receipt,
  Inbox,
  Globe,
  CalendarDays,
  ArrowRightLeft,
  Contact2,
  Users,
  BookOpen,
  LineChart,
  AlertTriangle,
  Bot,
  Heart,
  Shield,
  Camera,
  ChevronDown,
  ChevronRight,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import CopilotPanel from "@/components/copilot-panel";
import { CommandPalette } from "@/components/command-palette";
import TutorialOverlay from "@/components/tutorial-overlay";
import { ErrorBoundary } from "@/components/error-boundary";

interface NavCounts {
  apInbox?: number;
  reconcile?: number;
  anomalies?: number;
}

interface NavChild {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  badge?: keyof NavCounts;
  createAction?: string;
}

interface NavGroup {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  children: NavChild[];
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    icon: LayoutDashboard,
    children: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/health", label: "Health Score", icon: Heart },
      { href: "/saas-metrics", label: "SaaS Metrics", icon: Target },
    ],
  },
  {
    label: "Money Flow",
    icon: CreditCard,
    children: [
      { href: "/invoices", label: "Invoices", icon: FileText, createAction: "?new=1" },
      { href: "/expenses", label: "Expenses", icon: CreditCard, createAction: "?new=1" },
      { href: "/ap-inbox", label: "A/P Inbox", icon: Inbox, badge: "apInbox" },
      { href: "/revenue", label: "Revenue", icon: TrendingUp },
      { href: "/receipts", label: "Receipts", icon: Camera },
      { href: "/bank", label: "Bank", icon: Building2 },
      { href: "/reconciliation", label: "Reconcile", icon: GitMerge, badge: "reconcile" },
    ],
  },
  {
    label: "Planning",
    icon: Target,
    children: [
      { href: "/budgets", label: "Budgets", icon: Target },
      { href: "/forecast", label: "Forecast", icon: LineChart },
      { href: "/recurring", label: "Recurring", icon: Repeat },
      { href: "/payroll", label: "Payroll", icon: Users },
    ],
  },
  {
    label: "Compliance",
    icon: BarChart3,
    children: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/accounting", label: "Accounting", icon: BookOpen },
      { href: "/bookkeeper", label: "Bookkeeper", icon: Bot },
      { href: "/tds", label: "TDS", icon: Receipt },
      { href: "/gst", label: "GST Returns", icon: FileText },
      { href: "/fx", label: "FX Rates", icon: ArrowRightLeft },
      { href: "/compliance", label: "Calendar", icon: CalendarDays },
      { href: "/anomalies", label: "Anomalies", icon: AlertTriangle, badge: "anomalies" },
    ],
  },
  {
    label: "Admin",
    icon: Settings,
    children: [
      { href: "/consolidation", label: "HQ Rollup", icon: Globe },
      { href: "/clients", label: "Clients", icon: Contact2 },
      { href: "/vendors", label: "Vendors", icon: Store },
      { href: "/team", label: "Team", icon: Users },
      { href: "/import", label: "Import", icon: Download },
      { href: "/audit", label: "Audit Log", icon: Shield },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Flat list for mobile bottom nav
const mobileNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/expenses", label: "Expenses", icon: CreditCard },
  { href: "/revenue", label: "Revenue", icon: TrendingUp },
  { href: "/bank", label: "Bank", icon: Building2 },
];

interface Org {
  id: string;
  name: string;
  currency: string;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // B2B Embedded layouts, auth pages, and onboarding shouldn't have the main sidebar
  if (pathname?.startsWith("/embed") || pathname?.startsWith("/auth") || pathname?.startsWith("/onboarding")) {
    return <>{children}</>;
  }

  const { data: session } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  
  const [counts, setCounts] = useState<NavCounts>({});
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/layout-counts")
      .then(r => r.json())
      .then(d => setCounts(d))
      .catch(() => {});
  }, []);

  // Determine which groups are expanded — auto-open based on pathname
  const getInitialExpanded = () => {
    const expanded: Record<string, boolean> = {};
    navGroups.forEach((g) => {
      const hasActive = g.children.some(
        (c) => pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href))
      );
      expanded[g.label] = hasActive;
    });
    // Always expand Overview if nothing else matches
    if (!Object.values(expanded).some(Boolean)) expanded["Overview"] = true;
    return expanded;
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(getInitialExpanded);

  // Update expanded groups when pathname changes
  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      navGroups.forEach((g) => {
        const hasActive = g.children.some(
          (c) => pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href))
        );
        if (hasActive) next[g.label] = true;
      });
      return next;
    });
  }, [pathname]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const loadOrgs = useCallback(() => {
    fetch("/api/organizations")
      .then((r) => r.json())
      .then((d) => {
        setOrgs(d.organizations || []);
        setActiveOrgId(d.activeOrgId || null);
      })
      .catch(() => { });
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const switchOrg = (orgId: string) => {
    fetch("/api/organizations/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId }),
    }).then(() => {
      setActiveOrgId(orgId);
      setShowOrgDropdown(false);
      window.location.reload();
    });
  };

  const createOrg = () => {
    if (!newOrgName.trim()) return;
    fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newOrgName.trim() }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.organization) {
          switchOrg(d.organization.id);
          setNewOrgName("");
          setShowCreateOrg(false);
        }
      });
  };

  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  const isAuthPage = pathname.startsWith("/auth");
  if (isAuthPage) return <>{children}</>;

  return (
    <div className={`app-layout ${desktopCollapsed ? "collapsed" : ""}`}>
      {/* Skip to Content — A11y */}
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      {/* Mobile Header */}
      <div className="mobile-header" role="banner">
        <button
          className="hamburger"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={sidebarOpen}
          aria-controls="sidebar-nav"
        >
          <Menu size={24} aria-hidden="true" />
        </button>
        <h1><Wallet size={20} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} /> Finance</h1>
        <div style={{ width: 40 }} />
      </div>

      {/* Sidebar Overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside id="sidebar-nav" className={`sidebar ${sidebarOpen ? "open" : ""} ${desktopCollapsed ? "collapsed" : ""}`} role="navigation" aria-label="Main navigation">
        {/* Toggle Collapse Button */}
        <button
          onClick={() => setDesktopCollapsed(!desktopCollapsed)}
          aria-label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            position: "absolute", top: 24, right: -16, width: 32, height: 32,
            background: "var(--bg-card)", border: "1px solid var(--border-color)",
            borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", zIndex: 100, color: "var(--text-secondary)", transition: "var(--transition)"
          }}
          className="sidebar-collapse-toggle"
        >
          {desktopCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Wallet size={20} />
          </div>
          <div>
            <h1>Finance</h1>
            <span>Founder OS</span>
          </div>
          <button
            className="hamburger"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation menu"
            style={{
              marginLeft: "auto",
              display: sidebarOpen ? "flex" : "none",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Org Switcher */}
        {orgs.length > 0 && (
          <div style={{ padding: "0 12px 8px", position: "relative" }}>
            <button
              onClick={() => setShowOrgDropdown(!showOrgDropdown)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 8,
                background: "rgba(139, 92, 246, 0.1)", border: "1px solid rgba(139, 92, 246, 0.2)",
                color: "var(--text-primary)", cursor: "pointer", fontSize: 13,
                transition: "all 0.15s",
              }}
            >
              <Building2 size={14} style={{ color: "var(--accent-purple)", flexShrink: 0 }} />
              <span className="org-switcher-text" style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeOrg?.name || "Select Org"}
              </span>
              <ChevronDown className="org-switcher-chevron" size={14} style={{ color: "var(--text-muted)", flexShrink: 0, transform: showOrgDropdown ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>
            {showOrgDropdown && (
              <div style={{
                position: "absolute", top: "100%", left: 12, right: 12, zIndex: 100,
                background: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: 8, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                overflow: "hidden",
              }}>
                {orgs.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => switchOrg(org.id)}
                    style={{
                      width: "100%", padding: "10px 12px", border: "none",
                      background: org.id === activeOrgId ? "rgba(139, 92, 246, 0.15)" : "transparent",
                      color: "var(--text-primary)", cursor: "pointer", fontSize: 13,
                      textAlign: "left", display: "flex", alignItems: "center", gap: 8,
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <Building2 size={12} style={{ color: org.id === activeOrgId ? "var(--accent-purple)" : "var(--text-muted)" }} />
                    {org.name}
                    {org.id === activeOrgId && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent-purple)" }}>✓</span>}
                  </button>
                ))}
                {!showCreateOrg ? (
                  <button
                    onClick={() => setShowCreateOrg(true)}
                    style={{
                      width: "100%", padding: "10px 12px", border: "none",
                      background: "transparent", color: "var(--accent-purple)",
                      cursor: "pointer", fontSize: 13, textAlign: "left",
                      display: "flex", alignItems: "center", gap: 8,
                    }}
                  >
                    <Plus size={12} /> New Organization
                  </button>
                ) : (
                  <div style={{ padding: "8px 10px", display: "flex", gap: 6 }}>
                    <input
                      type="text" placeholder="Org name..."
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createOrg()}
                      autoFocus
                      style={{
                        flex: 1, padding: "6px 8px", borderRadius: 6, fontSize: 12,
                        background: "var(--bg-primary)", border: "1px solid var(--border-color)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <button onClick={createOrg} style={{
                      padding: "6px 10px", borderRadius: 6, border: "none",
                      background: "var(--accent-purple)", color: "#fff", fontSize: 12, cursor: "pointer",
                    }}>Add</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Global Search Hook */}
        <button className="sidebar-search-trigger" onClick={() => window.dispatchEvent(new Event("open-command-palette"))}>
          <Search size={14} />
          <span className="sidebar-search-text">Search...</span>
          <span className="sidebar-search-shortcut">⌘K</span>
        </button>

        <nav className="sidebar-nav">
          {navGroups.map((group) => {
            const isExpanded = expandedGroups[group.label] ?? false;
            const hasActive = group.children.some(
              (c) => pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href))
            );
            return (
              <div key={group.label} className="nav-group">
                <button
                  className={`nav-group-header ${hasActive ? "active" : ""}`}
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={isExpanded}
                  aria-label={`${group.label} section`}
                >
                  <group.icon size={16} />
                  <span>{group.label}</span>
                  <ChevronRight
                    size={14}
                    className={`nav-group-chevron ${isExpanded ? "expanded" : ""}`}
                  />
                </button>
                <div className={`nav-group-children ${isExpanded ? "expanded" : ""}`}>
                  {group.children.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== "/" && pathname.startsWith(item.href));
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`nav-item ${isActive ? "active" : ""}`}
                        onClick={() => setSidebarOpen(false)}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <item.icon size={16} />
                        <span>{item.label}</span>
                        {item.badge && counts[item.badge] ? (
                          <span className="nav-badge">{counts[item.badge]}</span>
                        ) : null}
                        {item.createAction && (
                          <button 
                            className="nav-quick-action"
                            aria-label={`Create new ${item.label.toLowerCase()}`}
                            onClick={(e) => { 
                              e.preventDefault();
                              e.stopPropagation(); 
                              setSidebarOpen(false);
                              router.push(`${item.href}${item.createAction}`);
                            }}
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User Profile */}
        {session?.user && (
          <div style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--border-color)",
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}>
            {/* Gradient-ring avatar — matches legal suite pattern */}
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "linear-gradient(135deg, #6366F1, #A855F7, #EC4899)",
              padding: 2, flexShrink: 0, overflow: "hidden",
            }}>
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{
                    width: 32, height: 32, borderRadius: "50%",
                    objectFit: "cover", display: "block",
                  }}
                />
              ) : (
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "var(--bg-sidebar, #0f1117)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, color: "#A855F7",
                }}>
                  {(session.user.name || session.user.email || "U").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="user-profile-info" style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {session.user.name}
              </div>
              <div style={{
                fontSize: 11,
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {session.user.email}
              </div>
            </div>
            <button
              className="user-profile-logout"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              title="Sign out"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: 4,
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main id="main-content" className="main-content" role="main" aria-label="Page content">{children}</main>

      <CommandPalette />

      {/* Copilot Panel */}
      <CopilotPanel />

      {/* Tutorial Overlay (shows once after onboarding) */}
      <TutorialOverlay />

      {/* Mobile Bottom Nav */}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mobile-nav-item ${isActive ? "active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
            >
              <item.icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>Finance — Founder OS</title>
        <meta
          name="description"
          content="Accounting, invoicing, expense tracking, runway projections, and GST compliance for startups"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Providers>
          <ErrorBoundary>
            <AppShell>{children}</AppShell>
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}

