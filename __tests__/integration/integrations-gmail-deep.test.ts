import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    integration: { findFirst: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { GET, POST, DELETE } from '@/app/api/integrations/gmail/route';

const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, userId: 'u1', organizationId: 'org-1' } as any);
  process.env.GOOGLE_CLIENT_ID = 'test_client_id';
});

describe('/api/integrations/gmail', () => {
  describe('GET', () => {
    it('returns connected status if integration exists', async () => {
      vi.mocked(prisma.integration.findFirst).mockResolvedValue({
        status: 'connected',
        lastSyncAt: new Date(),
        syncCount: 5,
        metadata: JSON.stringify({ email: 'test@gmail.com' })
      } as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.connected).toBe(true);
      expect(data.email).toBe('test@gmail.com');
      expect(data.syncCount).toBe(5);
    });

    it('returns disconnected status if integration does not exist', async () => {
      vi.mocked(prisma.integration.findFirst).mockResolvedValue(null);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.connected).toBe(false);
      expect(data.status).toBe('disconnected');
    });

    it('returns 500 on unexpected error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    it('returns 400 if GOOGLE_CLIENT_ID not set', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const res = await POST();
      expect(res.status).toBe(400);
    });

    it('returns auth url if GOOGLE_CLIENT_ID is set', async () => {
      const res = await POST();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(data.authUrl).toContain('client_id=test_client_id');
    });
  });

  describe('DELETE', () => {
    it('returns guard response if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await DELETE();
      expect(res.status).toBe(403);
    });

    it('deletes integration successfully', async () => {
      const res = await DELETE();
      expect(res.status).toBe(200);
      expect(prisma.integration.deleteMany).toHaveBeenCalled();
    });

    it('returns 500 on unexpected error', async () => {
      vi.mocked(prisma.integration.deleteMany).mockRejectedValue(new Error('fail'));
      const res = await DELETE();
      expect(res.status).toBe(500);
    });
  });
});
