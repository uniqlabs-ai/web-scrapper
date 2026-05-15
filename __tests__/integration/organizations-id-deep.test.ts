import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/guards';
import { PUT, DELETE } from '@/app/api/organizations/[id]/route';

const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mg.mockResolvedValue({ allowed: true, userId: 'u1', organizationId: 'org-1' } as any);
});

describe('/api/organizations/[id]', () => {
  describe('PUT', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/organizations/org-1'), {
        method: 'PUT',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns guard response if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await PUT(makeReq({ name: 'New' }), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(403);
    });

    it('returns 404 if org not found', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);
      const res = await PUT(makeReq({ name: 'New' }), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(404);
    });

    it('updates org successfully', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: 'org-1' } as any);
      vi.mocked(prisma.organization.update).mockResolvedValue({ id: 'org-1', name: 'New' } as any);
      const res = await PUT(makeReq({ name: 'New', currency: 'USD', gstNumber: '123' }), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(200);
      expect(prisma.organization.update).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exceptions', async () => {
      vi.mocked(prisma.organization.findFirst).mockRejectedValue(new Error('DB Down'));
      const res = await PUT(makeReq({ name: 'New' }), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    function makeReq(): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/organizations/org-1'), { method: 'DELETE' });
    }

    it('returns guard response if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(403);
    });

    it('returns 400 if it is the only org', async () => {
      vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: 'org-1' }] as any);
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(400);
    });

    it('deletes org successfully if there are multiple orgs', async () => {
      vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }] as any);
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(200);
      expect(prisma.organization.delete).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exceptions', async () => {
      vi.mocked(prisma.organization.findMany).mockRejectedValue(new Error('DB Down'));
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'org-1' }) });
      expect(res.status).toBe(500);
    });
  });
});
