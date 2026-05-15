"use client";

/**
 * PageSkeleton — Route-level loading state skeletons
 * Used by loading.tsx files across all 36 Finance pages.
 *
 * Each variant mirrors the real page layout to reduce Cumulative Layout Shift (CLS).
 */

import { SkeletonLine, SkeletonCard, SkeletonKPI, SkeletonTable } from "./skeleton";

/* ── Shared Pieces ── */

function SkeletonPageHeader() {
  return (
    <div style={{ marginBottom: 32 }}>
      {/* Breadcrumb skeleton */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <SkeletonLine width="40px" />
        <SkeletonLine width="8px" />
        <SkeletonLine width="80px" />
      </div>
      <SkeletonLine width="220px" />
      <div style={{ height: 8 }} />
      <SkeletonLine width="340px" />
    </div>
  );
}

function SkeletonKPIGrid({ count = 4 }: { count?: number }) {
  return (
    <div
      className="kpi-grid"
      style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonKPI key={i} />
      ))}
    </div>
  );
}

function SkeletonChartArea() {
  return (
    <div
      className="chart-container"
      style={{ minHeight: 260, opacity: 0.6 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <SkeletonLine width="140px" />
        <SkeletonLine width="80px" />
      </div>
      <div
        style={{
          height: 200,
          borderRadius: "var(--radius)",
          background: "var(--bg-tertiary, rgba(255,255,255,0.03))",
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
    </div>
  );
}

function SkeletonTableSection({ title }: { title?: string }) {
  return (
    <div className="table-container">
      {title && (
        <div className="table-header">
          <SkeletonLine width="160px" />
          <SkeletonLine width="100px" />
        </div>
      )}
      <SkeletonTable rows={6} />
    </div>
  );
}

/* ── Page Variants ── */

/** Dashboard: KPI grid + 2x2 chart grid */
export function DashboardSkeleton() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonKPIGrid count={4} />
      <div className="section-grid" style={{ marginTop: 24 }}>
        <SkeletonChartArea />
        <SkeletonChartArea />
      </div>
      <div className="section-grid" style={{ marginTop: 24 }}>
        <SkeletonChartArea />
        <SkeletonChartArea />
      </div>
    </div>
  );
}

/** Table-heavy pages: KPIs + data table */
export function TablePageSkeleton({ kpiCount = 4 }: { kpiCount?: number }) {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonKPIGrid count={kpiCount} />
      <div style={{ marginTop: 24 }}>
        <SkeletonTableSection title="Data" />
      </div>
    </div>
  );
}

/** Settings / Form pages */
export function FormPageSkeleton() {
  return (
    <div>
      <SkeletonPageHeader />
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 24 }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

/** Detail pages: e.g. /clients/[id], /vendors/[id], /payroll/[id] */
export function DetailPageSkeleton() {
  return (
    <div>
      <SkeletonPageHeader />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTableSection title="History" />
    </div>
  );
}

/** Reports / Analytics pages: header + chart + table */
export function AnalyticsPageSkeleton() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonKPIGrid count={3} />
      <div style={{ marginTop: 24 }}>
        <SkeletonChartArea />
      </div>
      <div style={{ marginTop: 24 }}>
        <SkeletonTableSection title="Data" />
      </div>
    </div>
  );
}

/** Onboarding / Auth pages: single centered card */
export function AuthPageSkeleton() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <SkeletonCard />
      </div>
    </div>
  );
}

/** Minimal page: just header + one card block (e.g. import, audit) */
export function MinimalPageSkeleton() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonCard />
    </div>
  );
}
