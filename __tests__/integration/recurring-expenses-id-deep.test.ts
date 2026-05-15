import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    recurringExpense: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bankTransaction: { findMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, PUT, DELETE } from '@/app/api/recurring-expenses/[id]/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/recurring-expenses/[id]', () => {
  function makeReq(method: string, body?: any): NextRequest {
    return new NextRequest(new URL('http://localhost:3008/api/recurring-expenses/1'), {
      method,
      headers: body ? new Headers({ 'content-type': 'application/json' }) : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  }

  describe('GET', () => {
    it('returns 404 if not found', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue(null);
      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(404);
    });

    it('returns details with matched transactions and alias branches', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue({ id: '1', description: 'zoom', aliases: '["zoom video inc full", "zoooom", "inc zoom"]', amount: 15 } as any);
      mp.bankTransaction.findMany.mockResolvedValue([
        { date: new Date('2024-01-15'), description: 'zoom video inc', amount: 15 }, // matchesPrimary=true, matchingAlias null (no alias fits)
        { date: new Date('2024-02-15'), description: 'zoooom billing', amount: 15 }, // matchesPrimary=false, matchingAlias='zoooom'
        { date: new Date('2024-03-15'), description: 'zoom video inc full billing', amount: 15 } // matchesPrimary=true, matchingAlias='zoom video inc full', alias.length (19) > primary.length (4)
      ] as any);

      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.item.amount).toBe(15);
      expect(data.matchedTransactions.length).toBe(3);
      expect(data.monthlySpend.length).toBe(3);
      expect(data.totalSpent).toBe(45);
      
      expect(data.matchedTransactions[0].matchedVia).toBeNull();
      expect(data.matchedTransactions[1].matchedVia).toBe('zoooom');
      expect(data.matchedTransactions[2].matchedVia).toBe('zoom video inc full');
    });

    it('handles malformed aliases JSON', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue({ id: '1', description: 'zoom', aliases: 'invalid', amount: 15 } as any);
      mp.bankTransaction.findMany.mockResolvedValue([]);

      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.matchedTransactions.length).toBe(0);
    });

    it('handles null/empty aliases gracefully', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue({ id: '1', description: 'zoom', aliases: null, amount: 15 } as any);
      mp.bankTransaction.findMany.mockResolvedValue([
        { date: new Date('2024-01-15'), description: 'zoom billing', amount: 15 },
      ] as any);

      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.matchedTransactions[0].matchedVia).toBeNull();
    });

    it('aggregates multiple transactions in same month', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue({ id: '1', description: 'zoom', aliases: '[]', amount: 15 } as any);
      mp.bankTransaction.findMany.mockResolvedValue([
        { date: new Date('2024-01-10'), description: 'zoom billing', amount: 15 },
        { date: new Date('2024-01-20'), description: 'zoom addon', amount: 10 },
      ] as any);

      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: '1' }) });
      const data = await res.json();
      expect(data.monthlySpend.length).toBe(1);
      expect(data.totalSpent).toBe(25);
    });

    it('returns 500 on unexpected exception', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(500);
    });
  });

  describe('PUT', () => {
    it('returns 404 if not found', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue(null);
      const res = await PUT(makeReq('PUT', { amount: 20 }), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(404);
    });

    it('updates expense fields correctly with valid and invalid amount', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue({ id: '1' } as any);
      mp.recurringExpense.update.mockResolvedValue({ id: '1', amount: 20 } as any);

      const res = await PUT(makeReq('PUT', { amount: '20', description: 'new', unknownField: 'ignore' }), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(200);
      expect(mp.recurringExpense.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { amount: 20, description: 'new' }
      }));
    });

    it('rejects non-numeric amount with 400 validation error', async () => {
      // Zod's z.coerce.number().nonnegative() converts 'invalid' to NaN, which fails validation
      const res = await PUT(makeReq('PUT', { amount: 'invalid', description: 'new' }), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid payload');
      expect(data.details).toBeDefined();
    });

    it('returns 500 on unexpected exception', async () => {
      mp.recurringExpense.findFirst.mockRejectedValue(new Error('fail'));
      const res = await PUT(makeReq('PUT', { amount: 20 }), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    it('returns 404 if not found', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue(null);
      const res = await DELETE(makeReq('DELETE'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(404);
    });

    it('deletes expense successfully', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue({ id: '1', description: 'test' } as any);
      mp.recurringExpense.delete.mockResolvedValue({ id: '1' } as any);

      const res = await DELETE(makeReq('DELETE'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(200);
      expect(mp.recurringExpense.delete).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exception', async () => {
      mp.recurringExpense.findFirst.mockRejectedValue(new Error('fail'));
      const res = await DELETE(makeReq('DELETE'), { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(500);
    });
  });
});
