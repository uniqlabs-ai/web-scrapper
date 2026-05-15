import { describe, it, expect } from 'vitest';
import {
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  hasPermission,
  type Role,
} from '@/lib/roles';

// ── ROLE_PERMISSIONS data integrity ──────────────────────────────────

describe('ROLE_PERMISSIONS', () => {
  it('defines all 4 roles', () => {
    const roles: Role[] = ['admin', 'accountant', 'viewer', 'approver'];
    for (const role of roles) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('admin has wildcard resource access', () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    expect(adminPerms).toHaveLength(1);
    expect(adminPerms[0].resource).toBe('*');
    expect(adminPerms[0].actions).toContain('create');
    expect(adminPerms[0].actions).toContain('read');
    expect(adminPerms[0].actions).toContain('update');
    expect(adminPerms[0].actions).toContain('delete');
    expect(adminPerms[0].actions).toContain('approve');
  });

  it('accountant has access to core financial resources', () => {
    const resources = ROLE_PERMISSIONS.accountant.map((p) => p.resource);
    expect(resources).toContain('invoices');
    expect(resources).toContain('expenses');
    expect(resources).toContain('revenue');
    expect(resources).toContain('vendors');
    expect(resources).toContain('bank');
    expect(resources).toContain('payroll');
    expect(resources).toContain('reconciliation');
  });

  it('accountant cannot delete resources', () => {
    for (const perm of ROLE_PERMISSIONS.accountant) {
      expect(perm.actions).not.toContain('delete');
    }
  });

  it('accountant cannot approve', () => {
    for (const perm of ROLE_PERMISSIONS.accountant) {
      expect(perm.actions).not.toContain('approve');
    }
  });

  it('viewer has read-only access', () => {
    for (const perm of ROLE_PERMISSIONS.viewer) {
      expect(perm.actions).toEqual(['read']);
    }
  });

  it('viewer can access reports, budgets, and compliance', () => {
    const resources = ROLE_PERMISSIONS.viewer.map((p) => p.resource);
    expect(resources).toContain('reports');
    expect(resources).toContain('budgets');
    expect(resources).toContain('compliance');
  });

  it('approver can read and approve expenses', () => {
    const expensePerm = ROLE_PERMISSIONS.approver.find((p) => p.resource === 'expenses');
    expect(expensePerm).toBeDefined();
    expect(expensePerm!.actions).toContain('read');
    expect(expensePerm!.actions).toContain('approve');
  });

  it('approver can approve payroll', () => {
    const payrollPerm = ROLE_PERMISSIONS.approver.find((p) => p.resource === 'payroll');
    expect(payrollPerm).toBeDefined();
    expect(payrollPerm!.actions).toContain('approve');
  });

  it('approver cannot create or update', () => {
    for (const perm of ROLE_PERMISSIONS.approver) {
      expect(perm.actions).not.toContain('create');
      expect(perm.actions).not.toContain('update');
    }
  });
});

// ── hasPermission ────────────────────────────────────────────────────

describe('hasPermission', () => {
  describe('admin role', () => {
    it('has access to all actions on all resources', () => {
      const actions = ['create', 'read', 'update', 'delete', 'approve'] as const;
      const resources = ['invoices', 'expenses', 'settings', 'anything'];
      for (const resource of resources) {
        for (const action of actions) {
          expect(hasPermission('admin', resource, action)).toBe(true);
        }
      }
    });
  });

  describe('accountant role', () => {
    it('can create invoices', () => {
      expect(hasPermission('accountant', 'invoices', 'create')).toBe(true);
    });

    it('can read invoices', () => {
      expect(hasPermission('accountant', 'invoices', 'read')).toBe(true);
    });

    it('can update invoices', () => {
      expect(hasPermission('accountant', 'invoices', 'update')).toBe(true);
    });

    it('cannot delete invoices', () => {
      expect(hasPermission('accountant', 'invoices', 'delete')).toBe(false);
    });

    it('cannot approve expenses', () => {
      expect(hasPermission('accountant', 'expenses', 'approve')).toBe(false);
    });

    it('can read reports but not create', () => {
      expect(hasPermission('accountant', 'reports', 'read')).toBe(true);
      expect(hasPermission('accountant', 'reports', 'create')).toBe(false);
    });

    it('can read TDS and GST', () => {
      expect(hasPermission('accountant', 'tds', 'read')).toBe(true);
      expect(hasPermission('accountant', 'gst', 'read')).toBe(true);
    });

    it('cannot access settings', () => {
      expect(hasPermission('accountant', 'settings', 'read')).toBe(false);
    });
  });

  describe('viewer role', () => {
    it('can read invoices', () => {
      expect(hasPermission('viewer', 'invoices', 'read')).toBe(true);
    });

    it('cannot create anything', () => {
      expect(hasPermission('viewer', 'invoices', 'create')).toBe(false);
      expect(hasPermission('viewer', 'expenses', 'create')).toBe(false);
    });

    it('cannot update anything', () => {
      expect(hasPermission('viewer', 'invoices', 'update')).toBe(false);
      expect(hasPermission('viewer', 'expenses', 'update')).toBe(false);
    });

    it('cannot delete anything', () => {
      expect(hasPermission('viewer', 'invoices', 'delete')).toBe(false);
    });

    it('cannot approve anything', () => {
      expect(hasPermission('viewer', 'expenses', 'approve')).toBe(false);
    });

    it('cannot access bank or payroll', () => {
      expect(hasPermission('viewer', 'bank', 'read')).toBe(false);
      expect(hasPermission('viewer', 'payroll', 'read')).toBe(false);
    });
  });

  describe('approver role', () => {
    it('can approve expenses', () => {
      expect(hasPermission('approver', 'expenses', 'approve')).toBe(true);
    });

    it('can approve invoices', () => {
      expect(hasPermission('approver', 'invoices', 'approve')).toBe(true);
    });

    it('can approve payroll', () => {
      expect(hasPermission('approver', 'payroll', 'approve')).toBe(true);
    });

    it('can read reports', () => {
      expect(hasPermission('approver', 'reports', 'read')).toBe(true);
    });

    it('cannot create expenses', () => {
      expect(hasPermission('approver', 'expenses', 'create')).toBe(false);
    });

    it('cannot update invoices', () => {
      expect(hasPermission('approver', 'invoices', 'update')).toBe(false);
    });

    it('cannot access vendors', () => {
      expect(hasPermission('approver', 'vendors', 'read')).toBe(false);
    });
  });

  describe('invalid role', () => {
    it('returns false for unknown role', () => {
      expect(hasPermission('superadmin' as Role, 'invoices', 'read')).toBe(false);
    });
  });

  describe('unassigned resource', () => {
    it('returns false when resource not in permissions', () => {
      expect(hasPermission('viewer', 'unknown-resource', 'read')).toBe(false);
      expect(hasPermission('accountant', 'unknown-resource', 'create')).toBe(false);
    });
  });
});

// ── ROLE_LABELS ──────────────────────────────────────────────────────

describe('ROLE_LABELS', () => {
  it('defines labels for all 4 roles', () => {
    const roles: Role[] = ['admin', 'accountant', 'viewer', 'approver'];
    for (const role of roles) {
      expect(ROLE_LABELS[role]).toBeDefined();
      expect(ROLE_LABELS[role].label).toBeTruthy();
      expect(ROLE_LABELS[role].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(ROLE_LABELS[role].description).toBeTruthy();
    }
  });

  it('admin has red color', () => {
    expect(ROLE_LABELS.admin.color).toBe('#EF4444');
  });

  it('labels are human-readable', () => {
    expect(ROLE_LABELS.admin.label).toBe('Admin');
    expect(ROLE_LABELS.accountant.label).toBe('Accountant');
    expect(ROLE_LABELS.viewer.label).toBe('Viewer');
    expect(ROLE_LABELS.approver.label).toBe('Approver');
  });
});
