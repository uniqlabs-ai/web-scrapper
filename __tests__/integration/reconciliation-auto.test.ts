import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankTransaction: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    revenue: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/reconciliation/auto/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

describe('POST /api/reconciliation/auto', () => {
  it('returns empty when no unreconciled transactions', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    const res = await POST();
    const d = await res.json();
    expect(d.matched).toBe(0);
    expect(d.pendingReview).toEqual([]);
  });

  it('matches debit transactions to expenses by amount and date', async () => {
    const date = new Date('2025-04-15');
    (mp.bankTransaction.findMany as any).mockResolvedValue([
      { id:'txn-1', amount:15000, description:'AWS Payment', date, type:'debit', isReconciled:false },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'exp-1', amount:15000, description:'AWS Services', date, category:{ name:'SaaS' } },
    ]);
    (mp.invoice.findMany as any).mockResolvedValue([]);
    (mp.revenue.findMany as any).mockResolvedValue([]);

    const res = await POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.pendingReview.length).toBe(1);
    expect(d.pendingReview[0].matchType).toBe('expense');
    expect(d.pendingReview[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('matches credit transactions to invoices by amount', async () => {
    const txnDate = new Date('2025-04-20');
    const invDate = new Date('2025-04-18');
    (mp.bankTransaction.findMany as any).mockResolvedValue([
      { id:'txn-2', amount:100000, description:'Credit from Acme', date:txnDate, type:'credit', isReconciled:false },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([]);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id:'inv-1', total:100000, invoiceNumber:'INV-001', issueDate:invDate, client:{ name:'Acme' }, payments:[] },
    ]);
    (mp.revenue.findMany as any).mockResolvedValue([]);

    const res = await POST();
    const d = await res.json();
    expect(d.pendingReview.length).toBe(1);
    expect(d.pendingReview[0].matchType).toBe('invoice');
    expect(d.pendingReview[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('matches credit transactions to revenue entries', async () => {
    const date = new Date('2025-04-15');
    (mp.bankTransaction.findMany as any).mockResolvedValue([
      { id:'txn-3', amount:50000, description:'Revenue credit', date, type:'credit', isReconciled:false },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([]);
    (mp.invoice.findMany as any).mockResolvedValue([]);
    (mp.revenue.findMany as any).mockResolvedValue([
      { id:'rev-1', amount:50000, month:date, source:'SaaS', category:'MRR' },
    ]);

    const res = await POST();
    const d = await res.json();
    expect(d.pendingReview.length).toBe(1);
    expect(d.pendingReview[0].matchType).toBe('revenue');
  });

  it('no matches when amounts differ significantly', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([
      { id:'txn-4', amount:50000, description:'Payment', date:new Date(), type:'debit', isReconciled:false },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'exp-2', amount:10000, description:'Different', date:new Date(), category:null },
    ]);
    (mp.invoice.findMany as any).mockResolvedValue([]);
    (mp.revenue.findMany as any).mockResolvedValue([]);

    const res = await POST();
    const d = await res.json();
    expect(d.pendingReview).toHaveLength(0);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
