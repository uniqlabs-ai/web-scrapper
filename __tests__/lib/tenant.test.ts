import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
}));

import { requireUser } from '@/lib/auth';
import { TenantError, requireTenant, tenantWhere, assertTenantOwnership } from '@/lib/tenant';

const mockedRequireUser = vi.mocked(requireUser);
beforeEach(() => { vi.clearAllMocks(); });

describe('TenantError', () => {
  it('is an Error with name TenantError', () => {
    const err = new TenantError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TenantError');
    expect(err.message).toBe('test');
  });
});

describe('requireTenant', () => {
  it('returns tenant context when user has organization', async () => {
    mockedRequireUser.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
    const ctx = await requireTenant();
    expect(ctx.userId).toBe('u1');
    expect(ctx.organizationId).toBe('org-1');
  });

  it('throws TenantError when user has no organization', async () => {
    mockedRequireUser.mockResolvedValue({ id: 'u2', organizationId: null } as any);
    await expect(requireTenant()).rejects.toThrow(TenantError);
    await expect(requireTenant()).rejects.toThrow('no organization');
  });

  it('propagates auth error when user not authenticated', async () => {
    mockedRequireUser.mockRejectedValue(new Error('Unauthorized'));
    await expect(requireTenant()).rejects.toThrow('Unauthorized');
  });
});

describe('tenantWhere', () => {
  const ctx = { userId: 'u1', organizationId: 'org-1' };

  it('returns organizationId by default', () => {
    const where = tenantWhere(ctx);
    expect(where).toEqual({ organizationId: 'org-1' });
    expect(where.userId).toBeUndefined();
  });

  it('includes userId when requested', () => {
    const where = tenantWhere(ctx, { includeUser: true });
    expect(where).toEqual({ organizationId: 'org-1', userId: 'u1' });
  });

  it('does not include userId when includeUser is false', () => {
    const where = tenantWhere(ctx, { includeUser: false });
    expect(where.userId).toBeUndefined();
  });
});

describe('assertTenantOwnership', () => {
  const ctx = { userId: 'u1', organizationId: 'org-1' };

  it('passes when resource belongs to tenant', () => {
    expect(() => assertTenantOwnership(ctx, 'org-1')).not.toThrow();
  });

  it('throws when resource belongs to different org', () => {
    expect(() => assertTenantOwnership(ctx, 'org-2')).toThrow(TenantError);
    expect(() => assertTenantOwnership(ctx, 'org-2')).toThrow('does not belong');
  });

  it('throws when resourceOrgId is null', () => {
    expect(() => assertTenantOwnership(ctx, null)).toThrow(TenantError);
  });

  it('throws when resourceOrgId is undefined', () => {
    expect(() => assertTenantOwnership(ctx, undefined)).toThrow(TenantError);
  });
});
