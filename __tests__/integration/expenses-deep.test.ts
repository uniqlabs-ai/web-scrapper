import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn(), create: vi.fn() },
    account: { update: vi.fn() },
    $transaction: vi.fn(async (cb) => {
      const tx = {
        expense: { create: vi.fn() },
        account: { update: vi.fn() }
      };
      return await cb(tx);
    }),
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant, TenantError } from '@/lib/tenant';
import { GET, POST } from '@/app/api/expenses/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/expenses', () => {
  describe('GET', () => {
    it('returns expenses', async () => {
      vi.mocked(prisma.expense.findMany).mockResolvedValue([{ id: 'exp1' } as any]);
      const req = new NextRequest(new URL('http://localhost:3008/api/expenses?categoryId=cat1&from=2024-01-01&to=2024-12-31'));
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.expenses.length).toBe(1);
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const req = new NextRequest(new URL('http://localhost:3008/api/expenses'));
      const res = await GET(req);
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/expenses'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 for invalid payload', async () => {
      const res = await POST(makeReq({ description: '' }));
      expect(res.status).toBe(400);
    });

    it('creates expense with account decrement successfully', async () => {
      // Mock $transaction callback behavior
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
        const tx = {
          expense: { create: vi.fn().mockResolvedValue({ id: 'exp1', userId: 'u1' }) },
          account: { update: vi.fn() }
        };
        return await (cb as any)(tx);
      });

      const res = await POST(makeReq({ description: 'Test', amount: 100, accountId: 'acc1', date: '2024-01-01' }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.expense.id).toBe('exp1');
    });

    it('returns 403 on tenant error', async () => {
      mt.mockRejectedValue(new TenantError('Unauthorized'));
      const res = await POST(makeReq({ description: 'Test', amount: 100 }));
      expect(res.status).toBe(403);
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await POST(makeReq({ description: 'Test', amount: 100 }));
      expect(res.status).toBe(500);
    });
  });
});
