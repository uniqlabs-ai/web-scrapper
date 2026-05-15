import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { update: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { PUT, DELETE } from '@/app/api/expenses/[id]/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, userId: 'u1', organizationId: 'org-1' } as any);
});

describe('/api/expenses/[id]', () => {
  describe('PUT', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/expenses/exp1'), {
        method: 'PUT',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('updates expense successfully', async () => {
      mp.expense.update.mockResolvedValue({ id: 'exp1', description: 'Updated' } as any);
      const res = await PUT(makeReq({ description: 'Updated', date: '2024-01-01' }), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(200);
      expect(mp.expense.update).toHaveBeenCalled();
    });

    it('returns guard response if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await PUT(makeReq({ description: 'Updated' }), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(403);
    });

    it('returns 500 on unexpected error', async () => {
      mg.mockRejectedValue(new Error('Failed'));
      const res = await PUT(makeReq({ description: 'Updated' }), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    function makeReq(): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/expenses/exp1'), { method: 'DELETE' });
    }

    it('deletes expense successfully', async () => {
      mp.expense.findFirst.mockResolvedValue({ id: 'exp1' } as any);
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(200);
      expect(mp.expense.delete).toHaveBeenCalled();
    });

    it('returns 404 if expense not found', async () => {
      mp.expense.findFirst.mockResolvedValue(null);
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(404);
    });

    it('returns 404 on P2025 error', async () => {
      mp.expense.findFirst.mockResolvedValue({ id: 'exp1' } as any);
      const err = new Error('Not found') as any;
      err.code = 'P2025';
      mp.expense.delete.mockRejectedValue(err);
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(404);
    });

    it('returns guard response if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(403);
    });

    it('returns 500 on unexpected error', async () => {
      mg.mockRejectedValue(new Error('Failed'));
      const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'exp1' }) });
      expect(res.status).toBe(500);
    });
  });
});
