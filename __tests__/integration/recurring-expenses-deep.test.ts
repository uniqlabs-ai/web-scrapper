import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    recurringExpense: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    expense: { create: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>{ console.error("TEST LOG ERROR:", e); return {message:e?.message||'Unknown',name:'Error'} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { GET, POST, PUT, PATCH, DELETE } from '@/app/api/recurring-expenses/route';

const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, userId: 'u1', organizationId: 'org-1' } as any);
});

describe('/api/recurring-expenses', () => {
  describe('GET', () => {
    it('returns recurring expenses successfully', async () => {
      vi.mocked(prisma.recurringExpense.findMany).mockResolvedValue([
        { id: 're-1', description: 'Zoom', amount: 15, nextDueDate: new Date(), aliases: '["zoom"]' },
        { id: 're-2', description: 'Zoom', amount: 15, nextDueDate: new Date(), aliases: '[]' }
      ] as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.recurringExpenses.length).toBe(1); // One is filtered as alias owner
    });

    it('returns 500 on unexpected error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/recurring-expenses'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 for invalid payload', async () => {
      const res = await POST(makeReq({ amount: -100 }));
      expect(res.status).toBe(400);
    });

    it('creates recurring expense fast-forwarding start date', async () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);
      
      vi.mocked(prisma.recurringExpense.create).mockResolvedValue({ id: 're-1' } as any);

      const res = await POST(makeReq({ description: 'Test', amount: 100, frequency: 'monthly', startDate: pastDate.toISOString() }));
      expect(res.status).toBe(201);
      expect(prisma.recurringExpense.create).toHaveBeenCalled();
    });

    it('returns 500 on unexpected error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await POST(makeReq({ description: 'Test', amount: 100 }));
      expect(res.status).toBe(500);
    });
  });

  describe('PUT', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/recurring-expenses'), {
        method: 'PUT',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 if ID is missing', async () => {
      const res = await PUT(makeReq({ isActive: true }));
      expect(res.status).toBe(400);
    });

    it('toggles active state successfully', async () => {
      vi.mocked(prisma.recurringExpense.update).mockResolvedValue({ isActive: false } as any);
      const res = await PUT(makeReq({ id: 're-1', isActive: false }));
      expect(res.status).toBe(200);
      expect(prisma.recurringExpense.update).toHaveBeenCalled();
    });

    it('returns 500 on unexpected error', async () => {
      vi.mocked(prisma.recurringExpense.update).mockRejectedValue(new Error('fail'));
      const res = await PUT(makeReq({ id: 're-1' }));
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    function makeReq(id?: string): NextRequest {
      const url = id ? `http://localhost:3008/api/recurring-expenses?id=${id}` : 'http://localhost:3008/api/recurring-expenses';
      return new NextRequest(new URL(url), { method: 'DELETE' });
    }

    it('returns guard response if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await DELETE(makeReq('re-1'));
      expect(res.status).toBe(403);
    });

    it('returns 400 if ID is missing', async () => {
      const res = await DELETE(makeReq());
      expect(res.status).toBe(400);
    });

    it('returns 404 if not found', async () => {
      vi.mocked(prisma.recurringExpense.findFirst).mockResolvedValue(null);
      const res = await DELETE(makeReq('re-1'));
      expect(res.status).toBe(404);
    });

    it('soft deletes successfully', async () => {
      vi.mocked(prisma.recurringExpense.update).mockResolvedValue({} as any);
      vi.mocked(prisma.recurringExpense.findFirst).mockResolvedValue({ id: 're-1' } as any);
      const res = await DELETE(makeReq('re-1'));
      expect(res.status).toBe(200);
      expect(prisma.recurringExpense.update).toHaveBeenCalled();
    });

    it('returns 500 on unexpected error', async () => {
      vi.mocked(prisma.recurringExpense.findFirst).mockRejectedValue(new Error('fail'));
      const res = await DELETE(makeReq('re-1'));
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH', () => {
    function makeReq(): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/recurring-expenses'), { method: 'PATCH' });
    }

    it('processes due recurring expenses successfully', async () => {
      vi.mocked(prisma.recurringExpense.update).mockResolvedValue({} as any);
      vi.mocked(prisma.recurringExpense.findMany).mockResolvedValue([
        { id: 're-1', amount: 100, frequency: 'weekly', nextDueDate: new Date(), endDate: new Date() },
        { id: 're-2', amount: 100, frequency: 'yearly', nextDueDate: new Date() },
        { id: 're-3', amount: 100, frequency: 'quarterly', nextDueDate: new Date() }
      ] as any);

      const res = await PATCH(makeReq());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.processed).toBe(3);
      expect(prisma.expense.create).toHaveBeenCalledTimes(3);
      expect(prisma.recurringExpense.update).toHaveBeenCalledTimes(3);
    });

    it('returns 500 on unexpected error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await PATCH(makeReq());
      expect(res.status).toBe(500);
    });
  });
});
