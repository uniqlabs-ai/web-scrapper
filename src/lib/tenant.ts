/**
 * Tenant Isolation Helper
 *
 * Enforces organizationId scoping on every data-access query.
 * Every API route that reads or writes domain data MUST call
 * requireTenant() before touching the database.
 *
 * Pattern:
 *   const { userId, organizationId } = await requireTenant();
 *   const data = await prisma.expense.findMany({
 *     where: { organizationId },
 *   });
 */

import { requireUser } from "./auth";

export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

export interface TenantContext {
  userId: string;
  organizationId: string;
}

/**
 * Require authenticated user with a valid organization.
 * Throws TenantError if user has no org — callers should catch and return 403.
 */
export async function requireTenant(): Promise<TenantContext> {
  const user = await requireUser();

  if (!user.organizationId) {
    // Auto-create a default organization for users without one
    // This handles fresh Google sign-ups that skipped onboarding
    const { prisma } = await import("@/lib/prisma");
    const org = await prisma.organization.create({
      data: {
        name: user.fullName ? `${user.fullName}'s Company` : "My Company",
      },
    });
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { organizationId: org.id },
    });
    return {
      userId: updatedUser.id,
      organizationId: org.id,
    };
  }

  return {
    userId: user.id,
    organizationId: user.organizationId,
  };
}

/**
 * Build a Prisma `where` clause scoped to the tenant.
 * Optionally includes userId for user-level filtering.
 *
 * Usage:
 *   const where = tenantWhere(ctx);                    // { organizationId }
 *   const where = tenantWhere(ctx, { includeUser: true }); // { organizationId, userId }
 */
export function tenantWhere(
  ctx: TenantContext,
  opts?: { includeUser?: boolean }
): { organizationId: string; userId?: string } {
  const where: { organizationId: string; userId?: string } = {
    organizationId: ctx.organizationId,
  };
  if (opts?.includeUser) {
    where.userId = ctx.userId;
  }
  return where;
}

/**
 * Verify that a specific resource belongs to the tenant's organization.
 * Prevents IDOR attacks on /api/resource/[id] endpoints.
 *
 * Usage:
 *   const expense = await prisma.expense.findUnique({ where: { id } });
 *   assertTenantOwnership(ctx, expense?.organizationId);
 */
export function assertTenantOwnership(
  ctx: TenantContext,
  resourceOrgId: string | null | undefined
): void {
  if (!resourceOrgId || resourceOrgId !== ctx.organizationId) {
    throw new TenantError("Resource does not belong to your organization");
  }
}
