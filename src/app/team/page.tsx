"use client";

import { useState, useEffect } from "react";
import {
  Users, UserPlus, Shield, Eye, Calculator, CheckSquare,
  Mail, Clock, FileText, CreditCard, Activity, X
} from "lucide-react";
import { useToast } from "@/components/toast";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface TeamUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  avatarUrl: string | null;
  createdAt: string;
  _count: { expenses: number; invoices: number; activityLogs: number };
}

interface ActivityItem {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: string | null;
  createdAt: string;
  user: { fullName: string | null; email: string; role: string };
}

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Shield; color: string; bg: string }> = {
  admin: { label: "Admin", icon: Shield, color: "#EF4444", bg: "rgba(239,68,68,0.15)" },
  accountant: { label: "Accountant", icon: Calculator, color: "#3B82F6", bg: "rgba(59,130,246,0.15)" },
  approver: { label: "Approver", icon: CheckSquare, color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  viewer: { label: "Viewer", icon: Eye, color: "#6B7280", bg: "rgba(107,114,128,0.15)" },
};

const ACTION_ICONS: Record<string, typeof FileText> = {
  created: FileText,
  updated: CreditCard,
  deleted: X,
  approved: CheckSquare,
  sent: Mail,
};

export default function TeamPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"members" | "activity">("members");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  useEffect(() => {
    loadUsers();
    loadActivity();
  }, []);

  const loadUsers = () => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const loadActivity = () => {
    fetch("/api/activity?limit=30")
      .then((r) => r.json())
      .then((d) => setActivities(d.activities || []))
      .catch(() => { });
  };

  const inviteUser = async () => {
    if (!inviteEmail) return;
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, fullName: inviteName, role: inviteRole }),
    });
    const data = await res.json();
    if (res.ok) {
      toast("User invited successfully!", "success");
      setShowInvite(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("viewer");
      loadUsers();
    } else {
      toast(data.error || "Failed to invite user", "error");
    }
  };

  const updateRole = async (userId: string, newRole: string) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      toast("Role updated", "success");
      loadUsers();
      loadActivity();
    } else {
      toast("Failed to update role", "error");
    }
  };

  const timeAgo = (date: string) => {
    // eslint-disable-next-line react-hooks/purity
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div>
      <PageHeader title="Team Management" description="Manage team members, assign roles, and view activity">
        <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
          <UserPlus size={16} /> Invite Member
        </button>
      </PageHeader>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 24,
        background: "var(--bg-secondary)", padding: 6, borderRadius: 12,
        width: "fit-content",
      }}>
        {(["members", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 20px", borderRadius: 10, border: "none",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s", whiteSpace: "nowrap",
              background: tab === t ? "var(--bg-card)" : "transparent",
              color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: tab === t ? "0 2px 8px rgba(0,0,0,0.25)" : "none",
            }}
          >
            <span style={{ color: tab === t ? "var(--brand-primary)" : "var(--text-secondary)", display: "flex" }}>
              {t === "members" ? <Users size={18} /> : <Activity size={18} />}
            </span>
            {t === "members" ? "Members" : "Activity Feed"}
            {t === "members" && (
              <span style={{
                fontSize: 11, padding: "1px 7px", borderRadius: 8, fontWeight: 700,
                background: tab === t ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.06)",
                color: tab === t ? "var(--brand-primary)" : "var(--text-secondary)",
              }}>{users.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div className="responsive-modal" role="dialog" aria-label="Invite team member" style={{
            backgroundColor: "#1F2937", borderRadius: 12, padding: 32,
            width: 440, position: "relative",
          }}>
            <button
              onClick={() => setShowInvite(false)}
              style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "#9CA3AF", cursor: "pointer" }}
              aria-label="Close invite dialog"
            >
              <X size={20} />
            </button>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>
              <UserPlus size={20} style={{ display: "inline", marginRight: 8 }} />
              Invite Team Member
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 6, display: "block" }}>Email *</label>
                <input
                  type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  style={{
                    width: "100%", padding: "10px 12px", backgroundColor: "#111827",
                    border: "1px solid #374151", borderRadius: 8, color: "white", fontSize: 14,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 6, display: "block" }}>Full Name</label>
                <input
                  type="text" value={inviteName} onChange={(e) => setInviteName(e.target.value)}
                  placeholder="John Doe"
                  style={{
                    width: "100%", padding: "10px 12px", backgroundColor: "#111827",
                    border: "1px solid #374151", borderRadius: 8, color: "white", fontSize: 14,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 6, display: "block" }}>Role</label>
                <div className="section-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {Object.entries(ROLE_CONFIG).map(([key, config]) => {
                    const Icon = config.icon;
                    return (
                      <button
                        key={key}
                        onClick={() => setInviteRole(key)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                          border: inviteRole === key ? `2px solid ${config.color}` : "2px solid #374151",
                          backgroundColor: inviteRole === key ? config.bg : "#111827",
                          color: inviteRole === key ? config.color : "#9CA3AF",
                          fontWeight: 600, fontSize: 13,
                        }}
                      >
                        <Icon size={16} /> {config.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={inviteUser}
                disabled={!inviteEmail}
                style={{
                  width: "100%", padding: "10px", borderRadius: 8, border: "none",
                  backgroundColor: inviteEmail ? "#6366F1" : "#374151",
                  color: "white", fontWeight: 600, fontSize: 14, cursor: inviteEmail ? "pointer" : "not-allowed",
                  marginTop: 8,
                }}
              >
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Tab */}
      {tab === "members" && (
        loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "#6B7280" }}>Loading team...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {users.map((user) => {
              const roleConfig = ROLE_CONFIG[user.role] || ROLE_CONFIG.viewer;
              const RoleIcon = roleConfig.icon;
              return (
                <div key={user.id} style={{
                  backgroundColor: "#111827", borderRadius: 12, border: "1px solid #1F2937",
                  padding: 20, display: "flex", alignItems: "center", gap: 16,
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%",
                    backgroundColor: "#6366F1", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 18, color: "white", flexShrink: 0,
                  }}>
                    {(user.fullName || user.email)[0].toUpperCase()}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{user.fullName || user.email}</div>
                    <div style={{ color: "#6B7280", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                      <Mail size={12} /> {user.email}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: "flex", gap: 16, color: "#6B7280", fontSize: 12 }}>
                    <span>{user._count.expenses} expenses</span>
                    <span>{user._count.invoices} invoices</span>
                    <span>{user._count.activityLogs} actions</span>
                  </div>

                  {/* Role selector */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <RoleIcon size={16} style={{ color: roleConfig.color }} />
                    <select
                      value={user.role}
                      onChange={(e) => updateRole(user.id, e.target.value)}
                      style={{
                        backgroundColor: roleConfig.bg, color: roleConfig.color,
                        border: `1px solid ${roleConfig.color}`, borderRadius: 6,
                        padding: "4px 8px", fontWeight: 600, fontSize: 12, cursor: "pointer",
                      }}
                    >
                      <option value="admin">Admin</option>
                      <option value="accountant">Accountant</option>
                      <option value="approver">Approver</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>

                  {/* Join date */}
                  <div style={{ color: "#6B7280", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock size={12} /> {new Date(user.createdAt).toLocaleDateString("en-IN")}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Activity Tab */}
      {tab === "activity" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activities.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="Team activity will appear here as members interact with the platform"
            />
          ) : (
            activities.map((activity) => {
              const ActionIcon = ACTION_ICONS[activity.action] || Activity;
              return (
                <div key={activity.id} style={{
                  backgroundColor: "#111827", borderRadius: 8, border: "1px solid #1F2937",
                  padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
                }}>
                  <ActionIcon size={16} style={{ color: "#6366F1", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{activity.user.fullName || activity.user.email}</span>
                    <span style={{ color: "#9CA3AF" }}> {activity.action} a </span>
                    <span style={{ fontWeight: 600, color: "#6366F1" }}>{activity.resource}</span>
                  </div>
                  <span style={{ color: "#6B7280", fontSize: 12, flexShrink: 0 }}>{timeAgo(activity.createdAt)}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
