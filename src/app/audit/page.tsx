"use client";

import { useState, useEffect } from "react";
import { Shield, RefreshCw, Search, User, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  userId: string;
  userName?: string;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  create: "#22C55E", update: "#6366F1", delete: "#EF4444",
  login: "#3B82F6", export: "#F59E0B", approve: "#14B8A6",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/audit")
      .then((r) => r.json())
      .then((d) => { setEntries(d.entries || d.logs || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filter
    ? entries.filter((e) =>
      e.action.toLowerCase().includes(filter.toLowerCase()) ||
      e.entity.toLowerCase().includes(filter.toLowerCase()) ||
      (e.details || "").toLowerCase().includes(filter.toLowerCase())
    )
    : entries;

  return (
    <div>
      <PageHeader title="Audit Log" description="Complete activity trail for compliance and security">
        <button className="btn btn-secondary" onClick={() => window.location.reload()} style={{ fontSize: 12, padding: "6px 14px" }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </PageHeader>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 11, color: "var(--text-tertiary)" }} />
          <input className="input" placeholder="Filter by action, entity, or details..."
            value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ paddingLeft: 32 }} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Loading audit trail...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={filter ? "No matching entries" : "No audit entries"}
          description={filter ? "Try adjusting your search filter." : "Activity will appear here as users interact with the system."}
        />
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Details</th>
                <th scope="col">User</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
                      <Clock size={12} />
                      {new Date(e.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: `${ACTION_COLORS[e.action] || "#666"}15`,
                      color: ACTION_COLORS[e.action] || "#666",
                      textTransform: "uppercase",
                    }}>
                      {e.action}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{e.entity}</td>
                  <td style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.details || "—"}
                  </td>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <User size={12} /> {e.userName || e.userId.slice(0, 8)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-tertiary)", textAlign: "right" }}>
        {filtered.length} entries {filter && `(filtered from ${entries.length})`}
      </div>
    </div>
  );
}
