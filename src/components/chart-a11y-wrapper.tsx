"use client";

/**
 * ChartAccessibilityWrapper — Wraps Recharts containers with proper
 * ARIA semantics for screen readers.
 *
 * Provides:
 * - role="img" + aria-label for the chart region
 * - A sr-only data table fallback for screen readers
 * - Preserves the visual chart untouched for sighted users
 */

import React from "react";

interface DataPoint {
  [key: string]: string | number | null | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDataPoint = Record<string, any>;

interface ChartAccessibilityWrapperProps {
  /** Descriptive label for the chart (e.g., "Revenue trend over last 6 months") */
  label: string;
  /** The chart data array for sr-only table generation */
  data?: AnyDataPoint[];
  /** Keys to include in the sr-only table (first key = row label, rest = values) */
  dataKeys?: string[];
  /** Children — the actual chart component */
  children: React.ReactNode;
}

export function ChartAccessibilityWrapper({
  label,
  data,
  dataKeys,
  children,
}: ChartAccessibilityWrapperProps) {
  return (
    <div role="img" aria-label={label}>
      {children}

      {/* Screen-reader-only data table */}
      {data && data.length > 0 && dataKeys && dataKeys.length > 0 && (
        <table className="sr-only" aria-label={`${label} — data table`}>
          <thead>
            <tr>
              {dataKeys.map((key) => (
                <th key={key} scope="col">
                  {key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((point, i) => (
              <tr key={i}>
                {dataKeys.map((key) => (
                  <td key={key}>
                    {point[key] != null ? String(point[key]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
