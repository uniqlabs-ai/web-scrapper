"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <div className="page-header" style={{ marginBottom: 32 }}>
      {/* Dynamic Breadcrumbs */}
      <nav aria-label="Breadcrumb" style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text-muted)",
        marginBottom: 16,
        textTransform: "uppercase",
        letterSpacing: "0.5px"
      }}>
        <Link href="/" style={{ color: "inherit", textDecoration: "none", display: "flex", alignItems: "center", transition: "color 0.2s" }} className="breadcrumb-link">
          <Home size={12} style={{ marginRight: 4 }} />
          Home
        </Link>
        {segments.map((segment, index) => {
          const href = "/" + segments.slice(0, index + 1).join("/");
          const isLast = index === segments.length - 1;
          const label = segment.replace(/-/g, " ");
          
          return (
            <React.Fragment key={segment}>
              <ChevronRight size={12} aria-hidden="true" />
              {isLast ? (
                <span style={{ color: "var(--text-primary)" }} aria-current="page">{label}</span>
              ) : (
                <Link href={href} style={{ color: "inherit", textDecoration: "none", transition: "color 0.2s" }} className="breadcrumb-link">
                  {label}
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6, letterSpacing: "-0.5px" }}>{title}</h2>
          {description && <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>{description}</p>}
        </div>
        {children && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {children}
          </div>
        )}
      </div>

      <style>{`
        .breadcrumb-link:hover {
          color: var(--brand-primary) !important;
        }
      `}</style>
    </div>
  );
}
