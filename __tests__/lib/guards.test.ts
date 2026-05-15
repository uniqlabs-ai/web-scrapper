import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tenant', () => ({
  requireTenant: vi.fn(),
  TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} },
}));
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn(),
}));

import { requireTenant, TenantError } from '@/lib/tenant';
import { checkPermission } from '@/lib/rbac';
import { requirePermission } from '@/lib/guards';

const mt = vi.mocked(requireTenant);
const mc = vi.mocked(checkPermission);

beforeEach(() => { vi.clearAllMocks(); });

describe('requirePermission', () => {
  it('returns allowed with userId/orgId when tenant and permission pass', async () => {
    mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
    mc.mockResolvedValue({ allowed: true } as any);

    const result = await requirePermission('read');
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.userId).toBe('u1');
      expect(result.organizationId).toBe('org-1');
    }
  });

  it('returns 403 when TenantError is thrown', async () => {
    mt.mockRejectedValue(new TenantError('No organization'));

    const result = await requirePermission('write');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      const d = await result.response.json();
      expect(result.response.status).toBe(403);
      expect(d.error).toBe('No organization');
    }
  });

  it('returns 401 for non-TenantError auth failures', async () => {
    mt.mockRejectedValue(new Error('Session expired'));

    const result = await requirePermission('read');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns denied when permission check fails', async () => {
    mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
    mc.mockResolvedValue({ allowed: false, error: 'Insufficient permissions', status: 403 } as any);

    const result = await requirePermission('manage_users');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      const d = await result.response.json();
      expect(d.error).toBe('Insufficient permissions');
      expect(result.response.status).toBe(403);
    }
  });
});
