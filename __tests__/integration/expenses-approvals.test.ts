import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn(), update: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/expenses/approvals/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/expenses/approvals', () => {
  function req(method='GET', body?:unknown, query=''): NextRequest {
    const init: Record<string,unknown> = { method };
    if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
    return new NextRequest(new URL(`http://localhost:3008/api/expenses/approvals${query}`), init);
  }

  describe('GET', () => {
    it('returns expenses with pending status filter', async () => {
      mp.expense.findMany.mockResolvedValue([
        { id: 'exp-1', amount: 100, date: new Date(), approvalStatus: 'pending', category: { name: 'Travel' } }
      ] as any);

      const res = await GET(req('GET', undefined, '?status=pending'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.expenses.length).toBe(1);
      expect(data.counts.pending).toBe(1);
      expect(mp.expense.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', organizationId: 'org-1', approvalStatus: 'pending' }
      }));
    });

    it('returns all expenses if status is all', async () => {
      mp.expense.findMany.mockResolvedValue([
        { id: 'exp-1', amount: 100, date: new Date(), approvalStatus: 'pending' },
        { id: 'exp-2', amount: 200, date: new Date(), approvalStatus: 'approved' },
        { id: 'exp-3', amount: 300, date: new Date(), approvalStatus: 'rejected' },
        { id: 'exp-4', amount: 400, date: new Date(), approvalStatus: 'reimbursed' },
        { id: 'exp-5', amount: 500, date: new Date() } // Uncategorized/No status
      ] as any);

      const res = await GET(req());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.expenses.length).toBe(5);
      expect(data.counts.pending).toBe(1);
      expect(data.counts.approved).toBe(1);
      expect(data.counts.rejected).toBe(1);
      expect(data.counts.reimbursed).toBe(1);
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(req());
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    it('returns 400 for invalid payload', async () => {
      const res = await POST(req('POST', { expenseId: 'exp-1' })); // missing action
      expect(res.status).toBe(400);
    });

    it('updates expense with approve action', async () => {
      mp.expense.update.mockResolvedValue({ id: 'exp-1' } as any);
      
      const res = await POST(req('POST', { expenseId: 'exp-1', action: 'approve', notes: 'Looks good' }));
      expect(res.status).toBe(200);
      expect(mp.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1', userId: 'u1', organizationId: 'org-1' },
        data: { source: 'approved', notes: 'approve: Looks good' }
      });
    });

    it('updates expense without notes', async () => {
      mp.expense.update.mockResolvedValue({ id: 'exp-1' } as any);
      
      const res = await POST(req('POST', { expenseId: 'exp-1', action: 'submit' }));
      expect(res.status).toBe(200);
      expect(mp.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1', userId: 'u1', organizationId: 'org-1' },
        data: { source: 'pending', notes: undefined }
      });
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await POST(req('POST', { expenseId: 'exp-1', action: 'approve' }));
      expect(res.status).toBe(500);
    });
  });
});
