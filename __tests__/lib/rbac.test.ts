import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import {
  hasPermission,
  getAllPermissions,
  getCurrentUser,
  checkPermission,
  logActivity,
  hasAccess,
  AVAILABLE_MODULES,
  type Role,
  type Permission,
} from '@/lib/rbac';

import { mockPrisma } from '../helpers/prisma-mock';
const mockedPrisma = mockPrisma(prisma);
const mockedGetSession = vi.mocked(getServerSession);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── hasPermission (simple role → permission check) ───────────────────

describe('hasPermission', () => {
  it('admin has all permissions', () => {
    const perms: Permission[] = ['read', 'write', 'delete', 'approve', 'manage_users'];
    for (const perm of perms) {
      expect(hasPermission('admin', perm)).toBe(true);
    }
  });

  it('accountant has read, write, delete', () => {
    expect(hasPermission('accountant', 'read')).toBe(true);
    expect(hasPermission('accountant', 'write')).toBe(true);
    expect(hasPermission('accountant', 'delete')).toBe(true);
  });

  it('accountant cannot approve or manage_users', () => {
    expect(hasPermission('accountant', 'approve')).toBe(false);
    expect(hasPermission('accountant', 'manage_users')).toBe(false);
  });

  it('approver has read and approve', () => {
    expect(hasPermission('approver', 'read')).toBe(true);
    expect(hasPermission('approver', 'approve')).toBe(true);
  });

  it('approver cannot write or delete', () => {
    expect(hasPermission('approver', 'write')).toBe(false);
    expect(hasPermission('approver', 'delete')).toBe(false);
  });

  it('viewer has only read', () => {
    expect(hasPermission('viewer', 'read')).toBe(true);
    expect(hasPermission('viewer', 'write')).toBe(false);
    expect(hasPermission('viewer', 'delete')).toBe(false);
    expect(hasPermission('viewer', 'approve')).toBe(false);
  });

  it('returns false for unknown role', () => {
    expect(hasPermission('superuser' as Role, 'read')).toBe(false);
  });
});

// ── getAllPermissions ─────────────────────────────────────────────────

describe('getAllPermissions', () => {
  it('returns all 5 permissions for admin', () => {
    const perms = getAllPermissions('admin');
    expect(perms).toHaveLength(5);
    expect(perms).toContain('read');
    expect(perms).toContain('write');
    expect(perms).toContain('delete');
    expect(perms).toContain('approve');
    expect(perms).toContain('manage_users');
  });

  it('returns 1 permission for viewer', () => {
    const perms = getAllPermissions('viewer');
    expect(perms).toEqual(['read']);
  });

  it('returns empty array for unknown role', () => {
    const perms = getAllPermissions('unknown' as Role);
    expect(perms).toEqual([]);
  });
});

// ── getCurrentUser ───────────────────────────────────────────────────

describe('getCurrentUser', () => {
  it('returns user with role from DB when session exists', async () => {
    mockedGetSession.mockResolvedValue({
      user: { email: 'admin@founderos.ai' },
    } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@founderos.ai',
      fullName: 'Admin',
      role: 'admin',
      organizationId: 'org-1',
    } as any);

    const user = await getCurrentUser();

    expect(user).not.toBeNull();
    expect(user!.email).toBe('admin@founderos.ai');
    expect(user!.role).toBe('admin');
  });

  it('defaults to viewer role when user has no role', async () => {
    mockedGetSession.mockResolvedValue({
      user: { email: 'norole@founderos.ai' },
    } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'norole@founderos.ai',
      fullName: 'No Role',
      role: null,
      organizationId: 'org-1',
    } as any);

    const user = await getCurrentUser();
    expect(user!.role).toBe('viewer');
  });

  it('returns null when no session', async () => {
    mockedGetSession.mockResolvedValue(null);
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  it('returns null when session has no email', async () => {
    mockedGetSession.mockResolvedValue({ user: {} } as any);
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  it('returns null when user not found in DB', async () => {
    mockedGetSession.mockResolvedValue({
      user: { email: 'ghost@founderos.ai' },
    } as any);
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const user = await getCurrentUser();
    expect(user).toBeNull();
  });
});

// ── checkPermission ──────────────────────────────────────────────────

describe('checkPermission', () => {
  it('returns allowed=true when user has permission', async () => {
    mockedGetSession.mockResolvedValue({
      user: { email: 'admin@founderos.ai' },
    } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'admin@founderos.ai', fullName: 'Admin',
      role: 'admin', organizationId: 'org-1',
    } as any);

    const result = await checkPermission('write');
    expect(result.allowed).toBe(true);
    expect('user' in result && result.user).toBeDefined();
  });

  it('returns 401 when no user session', async () => {
    mockedGetSession.mockResolvedValue(null);

    const result = await checkPermission('read');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.status).toBe(401);
      expect(result.error).toBe('Unauthorized');
    }
  });

  it('returns 403 when user lacks permission', async () => {
    mockedGetSession.mockResolvedValue({
      user: { email: 'viewer@founderos.ai' },
    } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'user-2', email: 'viewer@founderos.ai', fullName: 'Viewer',
      role: 'viewer', organizationId: 'org-1',
    } as any);

    const result = await checkPermission('write');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.status).toBe(403);
      expect(result.error).toContain('Insufficient permissions');
    }
  });
});

// ── logActivity ──────────────────────────────────────────────────────

describe('logActivity', () => {
  it('creates audit log entry', async () => {
    mockedPrisma.activityLog.create.mockResolvedValue({} as any);

    await logActivity('user-1', 'create', 'invoice', 'inv-1', { total: 10000 });

    expect(mockedPrisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        action: 'create',
        resource: 'invoice',
        resourceId: 'inv-1',
        metadata: JSON.stringify({ total: 10000 }),
        userId: 'user-1',
      },
    });
  });

  it('handles null resourceId', async () => {
    mockedPrisma.activityLog.create.mockResolvedValue({} as any);

    await logActivity('user-1', 'login', 'session');

    expect(mockedPrisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: null,
        metadata: null,
      }),
    });
  });

  it('does not throw on Prisma error (non-blocking)', async () => {
    mockedPrisma.activityLog.create.mockRejectedValue(new Error('DB down'));

    // Should not throw
    await expect(logActivity('user-1', 'create', 'invoice')).resolves.toBeUndefined();
  });
});

// ── hasAccess (module-level RBAC) ────────────────────────────────────

describe('hasAccess', () => {
  it('admin has access to everything', () => {
    expect(hasAccess({ role: 'admin' }, 'settings')).toBe(true);
    expect(hasAccess({ role: 'admin' }, 'payroll')).toBe(true);
    expect(hasAccess({ role: 'admin' }, 'bank')).toBe(true);
    expect(hasAccess({ role: 'admin' }, 'anything')).toBe(true);
  });

  it('accountant can access invoices, expenses, vendors', () => {
    const user = { role: 'accountant' };
    expect(hasAccess(user, 'invoices')).toBe(true);
    expect(hasAccess(user, 'expenses')).toBe(true);
    expect(hasAccess(user, 'vendors')).toBe(true);
    expect(hasAccess(user, 'reconciliation')).toBe(true);
  });

  it('accountant is blocked from settings, bank, payroll', () => {
    const user = { role: 'accountant' };
    expect(hasAccess(user, 'settings')).toBe(false);
    expect(hasAccess(user, 'bank')).toBe(false);
    expect(hasAccess(user, 'payroll')).toBe(false);
  });

  it('viewer can access dashboard and reports', () => {
    const user = { role: 'viewer' };
    expect(hasAccess(user, 'dashboard')).toBe(true);
    expect(hasAccess(user, 'reports')).toBe(true);
    expect(hasAccess(user, 'invoices')).toBe(true);
  });

  it('viewer is blocked from settings, bank, payroll', () => {
    const user = { role: 'viewer' };
    expect(hasAccess(user, 'settings')).toBe(false);
    expect(hasAccess(user, 'bank')).toBe(false);
    expect(hasAccess(user, 'payroll')).toBe(false);
  });

  it('approver can access dashboard and expenses', () => {
    const user = { role: 'approver' };
    expect(hasAccess(user, 'dashboard')).toBe(true);
    expect(hasAccess(user, 'expenses')).toBe(true);
    expect(hasAccess(user, 'reports')).toBe(true);
  });

  it('custom role resolves against permissions JSON', () => {
    const user = { role: 'custom', permissions: JSON.stringify(['invoices', 'expenses']) };
    expect(hasAccess(user, 'invoices')).toBe(true);
    expect(hasAccess(user, 'expenses')).toBe(true);
    expect(hasAccess(user, 'payroll')).toBe(false);
  });

  it('custom role with wildcard has full access', () => {
    const user = { role: 'custom', permissions: JSON.stringify(['*']) };
    expect(hasAccess(user, 'anything')).toBe(true);
  });

  it('custom role with invalid JSON returns false', () => {
    const user = { role: 'custom', permissions: 'not-json' };
    expect(hasAccess(user, 'invoices')).toBe(false);
  });

  it('returns true (dev fallback) when user has no role or permissions', () => {
    expect(hasAccess({}, 'invoices')).toBe(true);
    expect(hasAccess(undefined, 'invoices')).toBe(true);
    expect(hasAccess(null, 'invoices')).toBe(true);
  });
});

// ── AVAILABLE_MODULES ────────────────────────────────────────────────

describe('AVAILABLE_MODULES', () => {
  it('contains at least 8 modules', () => {
    expect(AVAILABLE_MODULES.length).toBeGreaterThanOrEqual(8);
  });

  it('each module has id and label', () => {
    for (const mod of AVAILABLE_MODULES) {
      expect(mod.id).toBeTruthy();
      expect(mod.label).toBeTruthy();
    }
  });

  it('includes core modules: dashboard, invoices, expenses', () => {
    const ids = AVAILABLE_MODULES.map((m) => m.id);
    expect(ids).toContain('dashboard');
    expect(ids).toContain('invoices');
    expect(ids).toContain('expenses');
  });
});
