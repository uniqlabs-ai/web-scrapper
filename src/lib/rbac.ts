/**
 * RBAC (Role-Based Access Control) Middleware
 *
 * Roles: admin, accountant, viewer, approver
 *
 * Permissions:
 * - admin:      Full access (read, write, delete, manage users)
 * - accountant: Read + Write (create/edit invoices, expenses, reports)
 * - approver:   Read + Approve/Reject expenses
 * - viewer:     Read-only access
 */

import { prisma } from "@/lib/prisma";
import { log, toLogError } from "@/lib/logger";

export type Role = "admin" | "accountant" | "viewer" | "approver" | "custom";
export type Permission = "read" | "write" | "delete" | "approve" | "manage_users";

export interface UserSession {
  id?: string;
  email?: string | null;
  role?: string;
  permissions?: string | null; // stringified JSON array
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ["read", "write", "delete", "approve", "manage_users"],
  accountant: ["read", "write", "delete"],
  approver: ["read", "approve"],
  viewer: ["read"],
  custom: ["read", "write", "delete", "approve"], // Detailed module boundaries handled by hasAccess()
};

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getAllPermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Get current user with role. In production, this reads from NextAuth session.
 */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, fullName: true, role: true, organizationId: true },
  });

  return user ? { ...user, role: (user.role as Role) || "viewer" } : null;
}

/**
 * Check if current user has required permission.
 * Returns { allowed: true, user } or { allowed: false, error }.
 */
export async function checkPermission(permission: Permission) {
  const user = await getCurrentUser();

  if (!user) {
    return { allowed: false as const, error: "Unauthorized", status: 401 };
  }

  if (!hasPermission(user.role, permission)) {
    return {
      allowed: false as const,
      error: `Insufficient permissions. Role '${user.role}' does not have '${permission}' access.`,
      status: 403,
    };
  }

  return { allowed: true as const, user };
}

/**
 * Log an activity to the ActivityLog table.
 */
export async function logActivity(
  userId: string,
  action: string,
  resource: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.activityLog.create({
      data: {
        action,
        resource,
        resourceId: resourceId || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        userId,
      },
    });
  } catch (error) {
    log.error("Failed to log activity", { module: "rbac", action, userId, error: toLogError(error) });
  }
}

// Map standard roles to their default allowed modules for NextAuth Edge routing
const ROLE_POLICIES: Record<Role, string[]> = {
  admin: ["*"], // Admins can access everything
  accountant: ["dashboard", "invoices", "expenses", "receipts", "vendors", "clients", "reports", "accounting", "gst", "tds", "reconciliation"],
  approver: ["dashboard", "expenses", "reports"],
  viewer: ["dashboard", "invoices", "expenses", "receipts", "vendors", "clients", "reports", "gst", "tds", "compliance"],
  custom: [], // Custom resolves against `permissions` array
};

export function hasAccess(user: UserSession | undefined | null, module: string): boolean {
  // Safe fallback if user state is unknown
  if (!user || (!user.role && !user.permissions)) return true; // For local dev fallback

  const role = (user.role as Role) || "viewer";

  if (role === "admin") return true;

  if (role === "custom") {
    try {
      const perms: string[] = user.permissions ? JSON.parse(user.permissions) : [];
      return perms.includes("*") || perms.includes(module);
    } catch {
      return false;
    }
  }

  // Fallback to strict standard role evaluation
  const policy = ROLE_POLICIES[role] || ROLE_POLICIES["viewer"];
  if (module === "settings" || module === "bank" || module === "payroll") return false; // Enforce blocks on strict roles

  return policy.includes(module);
}

// Available modular segments for the settings toggle
export const AVAILABLE_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "invoices", label: "Invoices" },
  { id: "expenses", label: "Expenses" },
  { id: "bank", label: "Bank Integration" },
  { id: "reconciliation", label: "Bank Reconciliation" },
  { id: "payroll", label: "Payroll Engine" },
  { id: "accounting", label: "Accounting Engine" },
  { id: "settings", label: "Settings & Administration" },
];
