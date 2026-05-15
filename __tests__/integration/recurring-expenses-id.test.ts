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

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, PUT, DELETE } from '@/app/api/recurring-expenses/[id]/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method='GET', body?:unknown, id: string='exp-1'): [NextRequest, { params: Promise<{id:string}> }] {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return [new NextRequest(new URL(`http://localhost:3008/api/recurring-expenses/${id}`), init), { params: Promise.resolve({ id }) }];
}

describe('recurring-expenses/[id]', () => {
  describe('GET', () => {
    it('returns 404 if not found', async () => {
      (mp.recurringExpense.findFirst as any).mockResolvedValue(null);
      const res = await GET(...req());
      expect(res.status).toBe(404);
    });

    it('returns recurring expense details and related transactions', async () => {
      (mp.recurringExpense.findFirst as any).mockResolvedValue({ id: 'exp-1', vendor: 'AWS', description: 'AWS Cloud', aliases: '["Amazon Web"]', amount: 500, category: 'Software' });
      (mp.bankTransaction.findMany as any).mockResolvedValue([
        { id: 'bt-1', description: 'Amazon Web Services', amount: 500, date: new Date() }
      ]);

      const res = await GET(...req());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.item.id).toBe('exp-1');
      expect(data.matchedTransactions.length).toBe(1);
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(...req());
      expect(res.status).toBe(500);
    });
  });

  describe('PUT', () => {
    it('returns 200 and ignores invalid fields', async () => {
      (mp.recurringExpense.findFirst as any).mockResolvedValue({ id: 'exp-1' });
      (mp.recurringExpense.update as any).mockResolvedValue({ id: 'exp-1' });
      const res = await PUT(...req('PUT', { completelyInvalid: true })); 
      expect(res.status).toBe(200);
      expect(mp.recurringExpense.update).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
    });

    it('returns 404 if expense not found', async () => {
      (mp.recurringExpense.findFirst as any).mockResolvedValue(null);
      const res = await PUT(...req('PUT', { vendor: 'AWS', amount: 600, frequency: 'monthly', status: 'active', category: 'Software' }));
      expect(res.status).toBe(404);
    });

    it('updates expense successfully', async () => {
      (mp.recurringExpense.findFirst as any).mockResolvedValue({ id: 'exp-1' });
      (mp.recurringExpense.update as any).mockResolvedValue({ id: 'exp-1', vendor: 'AWS', amount: 600 });
      
      const res = await PUT(...req('PUT', { vendor: 'AWS', amount: 600, frequency: 'monthly', status: 'active', category: 'Software' }));
      expect(res.status).toBe(200);
      expect(mp.recurringExpense.update).toHaveBeenCalled();
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await PUT(...req('PUT', { vendor: 'AWS', amount: 600, frequency: 'monthly', status: 'active', category: 'Software' }));
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    it('returns 404 if not found', async () => {
      (mp.recurringExpense.findFirst as any).mockResolvedValue(null);
      const res = await DELETE(...req());
      expect(res.status).toBe(404);
    });

    it('deletes expense successfully', async () => {
      (mp.recurringExpense.findFirst as any).mockResolvedValue({ id: 'exp-1' });
      (mp.recurringExpense.delete as any).mockResolvedValue({ id: 'exp-1' });
      const res = await DELETE(...req());
      expect(res.status).toBe(200);
      expect(mp.recurringExpense.delete).toHaveBeenCalled();
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await DELETE(...req());
      expect(res.status).toBe(500);
    });
  });
});
