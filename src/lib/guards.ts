/**
 * RBAC Guard — Composable permission check for route handlers.
 *
 * Usage:
 *   const guard = await requirePermission("write");
 *   if (!guard.allowed) return guard.response;
 *   // guard.userId and guard.organizationId are available
 *
 * Combines tenant isolation (requireTenant) with role-based permission checks.
 */

import { NextResponse } from "next/server";
import { requireTenant, TenantError, TenantContext } from "./tenant";
import { checkPermission, Permission } from "./rbac";

export interface PermissionGuard {
  allowed: true;
  userId: string;
  organizationId: string;
}

export interface PermissionDenied {
  allowed: false;
  response: NextResponse;
}

/**
 * Require both tenant context AND a specific RBAC permission.
 * Returns a discriminated union — check `allowed` before using.
 *
 * Usage:
 *   const guard = await requirePermission("write");
 *   if (!guard.allowed) return guard.response;
 *   const { userId, organizationId } = guard;
 */
export async function requirePermission(
  permission: Permission
): Promise<PermissionGuard | PermissionDenied> {
  // 1. Tenant isolation
  let ctx: TenantContext;
  try {
    ctx = await requireTenant();
  } catch (error) {
    if (error instanceof TenantError) {
      return {
        allowed: false,
        response: NextResponse.json({ error: error.message }, { status: 403 }),
      };
    }
    return {
      allowed: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // 2. Permission check
  const permCheck = await checkPermission(permission);
  if (!permCheck.allowed) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: permCheck.error },
        { status: permCheck.status }
      ),
    };
  }

  return {
    allowed: true,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
  };
}
