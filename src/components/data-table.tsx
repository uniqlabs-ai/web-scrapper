"use client";

import React, { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

export interface ColumnDef<T> {
  header: React.ReactNode | string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  sortable?: boolean;
  align?: "left" | "center" | "right";
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  searchPlaceholder?: string;
  searchFilter?: (item: T, query: string) => boolean;
  emptyState?: React.ReactNode;
  onRowClick?: (item: T) => void;
  renderExpandedRow?: (item: T) => React.ReactNode;
}

export function DataTable<T>({ data, columns, searchPlaceholder = "Search...", searchFilter, emptyState, onRowClick, renderExpandedRow }: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sortConf, setSortConf] = useState<{ key: keyof T | null; direction: "asc" | "desc" }>({ key: null, direction: "asc" });

  const filteredData = useMemo(() => {
    if (!query || !searchFilter) return data;
    return data.filter((item) => searchFilter(item, query));
  }, [data, query, searchFilter]);

  const sortedData = useMemo(() => {
    if (!sortConf.key) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortConf.key!];
      const bVal = b[sortConf.key!];
      
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConf.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortConf.direction === "asc" ? -1 : 1;
      if (aStr > bStr) return sortConf.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConf]);

  const handleSort = (key?: keyof T, sortable?: boolean) => {
    if (!key || sortable === false) return;
    setSortConf((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  return (
    <div className="table-container">
      {searchFilter && (
        <div className="table-header" style={{ display: "flex", gap: 12, borderBottom: "1px solid var(--border-color)" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} aria-hidden="true" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={searchPlaceholder}
              role="searchbox"
              style={{
                width: "100%", padding: "10px 12px 10px 36px", background: "var(--bg-secondary)",
                border: "1px solid var(--border-color)", borderRadius: 8, color: "var(--text-primary)", outline: "none"
              }}
            />
          </div>
          {query && (
            <span className="sr-only" aria-live="polite">
              {sortedData.length} result{sortedData.length !== 1 ? "s" : ""} found
            </span>
          )}
        </div>
      )}

      {sortedData.length === 0 ? (
        emptyState ? emptyState : <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>No records found.</div>
      ) : (
        <div style={{ width: "100%", overflowX: "auto" }} role="region" aria-label="Data table" tabIndex={0}>
          <table role="table">
            <thead role="rowgroup">
              <tr role="row">
                {columns.map((c, i) => {
                  const isSortable = c.sortable !== false && !!c.accessorKey;
                  const isSorted = sortConf.key === c.accessorKey;
                  const sortDir = isSorted ? (sortConf.direction === "asc" ? "ascending" : "descending") : undefined;
                  return (
                  <th
                    key={i}
                    role="columnheader"
                    aria-sort={isSortable ? (sortDir || "none") : undefined}
                    onClick={() => handleSort(c.accessorKey, c.sortable)}
                    style={{
                      cursor: isSortable ? "pointer" : "default",
                      textAlign: c.align || "left",
                      whiteSpace: "nowrap"
                    }}
                  >
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start", width: "100%" }}>
                      {c.header}
                      {c.sortable !== false && c.accessorKey && (
                        <span style={{ color: sortConf.key === c.accessorKey ? "var(--brand-primary)" : "var(--text-muted)", opacity: sortConf.key === c.accessorKey ? 1 : 0.4 }}>
                          {sortConf.key === c.accessorKey ? (
                           sortConf.direction === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                          ) : (
                            <ChevronsUpDown size={12} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                  );
                })}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {sortedData.map((row, i) => (
                <React.Fragment key={i}>
                  <tr
                    role="row"
                    onClick={() => onRowClick?.(row)}
                    onKeyDown={(e) => { if (onRowClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(row); } }}
                    tabIndex={onRowClick ? 0 : undefined}
                    style={{ cursor: onRowClick ? "pointer" : "default" }}
                  >
                    {columns.map((c, idx) => (
                      <td key={idx} role="cell" style={{ textAlign: c.align || "left" }}>
                        {c.cell ? c.cell(row) : c.accessorKey ? (row[c.accessorKey] as React.ReactNode) : null}
                      </td>
                    ))}
                  </tr>
                  {renderExpandedRow && renderExpandedRow(row)}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
