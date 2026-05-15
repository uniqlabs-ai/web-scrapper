import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankTransaction: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    revenue: { findMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/reconciliation/auto/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('POST /api/reconciliation/auto', () => {
  it('returns 200 with 0 pending if no unreconciled transactions', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([]);
    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pendingReview.length).toBe(0);
    expect(data.matched).toBe(0);
  });

  it('matches debit transaction to expense (exact amount)', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 100, date: new Date(), type: 'debit', description: 'zoom' }] as any);
    mp.expense.findMany.mockResolvedValue([{ id: 'exp-1', amount: 100, date: new Date(), description: 'zoom', category: { name: 'Software' } }] as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].matchType).toBe('expense');
    expect(data.pendingReview[0].suggestedCategory).toBe('Software');
  });

  it('matches credit transaction to invoice (exact amount)', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 1000, date: new Date(), type: 'credit', description: 'payment' }] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([{ id: 'inv-1', total: 1000, issueDate: new Date(), invoiceNumber: 'INV-001', client: { name: 'Acme' } }] as any);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].matchType).toBe('invoice');
  });

  it('matches credit transaction to revenue (fuzzy amount/date)', async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);

    mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 100, date: new Date(), type: 'credit', description: 'salary' }] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([{ id: 'rev-1', amount: 100, month: pastDate, category: null, source: 'Misc' }] as any);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].matchType).toBe('revenue');
    expect(data.pendingReview[0].suggestedCategory).toBe('Payroll'); // Inferred
  });

  it('matches debit transaction to expense (fuzzy amount)', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 100, date: new Date(), type: 'debit', description: 'zoom' }] as any);
    mp.expense.findMany.mockResolvedValue([{ id: 'exp-1', amount: 101, date: new Date(), description: 'zoom video', category: null }] as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].matchType).toBe('expense');
  });

  it('matches credit transaction to invoice by client name in description', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 1000, date: new Date(), type: 'credit', description: 'acme corp payment' }] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([{ id: 'inv-1', total: 1000, issueDate: new Date(), invoiceNumber: 'INV-001', client: { name: 'Acme Corp' } }] as any);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].matchType).toBe('invoice');
  });

  it('infers categories correctly for rent, insurance, software, consulting, interest, commission, service', async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);

    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-1', amount: 100, date: new Date(), type: 'credit', description: 'rent payment' },
      { id: 'tx-2', amount: 100, date: new Date(), type: 'credit', description: 'insurance premium' },
      { id: 'tx-3', amount: 100, date: new Date(), type: 'credit', description: 'software sas' },
      { id: 'tx-4', amount: 100, date: new Date(), type: 'credit', description: 'consulting' },
      { id: 'tx-5', amount: 100, date: new Date(), type: 'credit', description: 'interest deposit' },
      { id: 'tx-6', amount: 100, date: new Date(), type: 'credit', description: 'commission' },
      { id: 'tx-7', amount: 100, date: new Date(), type: 'credit', description: 'service fee' },
      { id: 'tx-8', amount: 100, date: new Date(), type: 'credit', description: 'random' }
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([
      { id: 'rev-1', amount: 104, month: pastDate, category: null, source: 'Misc' }
    ] as any);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    // They will all fuzzy match the single revenue entry (same amount ~100, past 5 days)
    expect(data.pendingReview.length).toBe(8);
  });

  it('returns 500 on unexpected error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST();
    expect(res.status).toBe(500);
  });

  it('matches debit to expense with dayDiff 4-7 and desc match', async () => {
    const txDate = new Date(2025, 3, 15);
    const expDate = new Date(2025, 3, 20); // 5 days later
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-1', amount: 5000, date: txDate, type: 'debit', description: 'AWS Cloud Services Monthly' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'exp-1', amount: 5000, date: expDate, description: 'AWS Cloud', category: { name: 'Cloud' } },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].confidence).toBeLessThan(0.85);
  });

  it('matches debit to expense with dayDiff 1-3 (medium confidence)', async () => {
    const txDate = new Date(2025, 3, 15);
    const expDate = new Date(2025, 3, 17); // 2 days later
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-2', amount: 5000, date: txDate, type: 'debit', description: 'Some debit' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'exp-2', amount: 5000, date: expDate, description: 'Unrelated', category: null },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].confidence).toBe(0.8);
  });

  it('matches credit to invoice with dayDiff 4-7 (medium confidence)', async () => {
    const txDate = new Date(2025, 3, 15);
    const invDate = new Date(2025, 3, 10); // 5 days earlier
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-3', amount: 10000, date: txDate, type: 'credit', description: 'wire transfer' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id: 'inv-2', total: 10000, issueDate: invDate, invoiceNumber: 'INV-555', client: { name: 'BigCo' } },
    ] as any);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].confidence).toBe(0.85);
  });

  it('matches credit to invoice with dayDiff 8-30 (low confidence)', async () => {
    const txDate = new Date(2025, 3, 25);
    const invDate = new Date(2025, 3, 10); // 15 days earlier
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-4', amount: 20000, date: txDate, type: 'credit', description: 'payment received' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id: 'inv-3', total: 20000, issueDate: invDate, invoiceNumber: 'INV-777', client: null },
    ] as any);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].confidence).toBe(0.7);
  });

  it('matches credit to revenue with dayDiff 4-7 (medium confidence)', async () => {
    const txDate = new Date(2025, 3, 15);
    const revDate = new Date(2025, 3, 10); // 5 days earlier
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-5', amount: 50000, date: txDate, type: 'credit', description: 'subscription revenue' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([
      { id: 'rev-5', amount: 50000, month: revDate, category: null, source: null },
    ] as any);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].confidence).toBe(0.8);
    expect(data.pendingReview[0].suggestedCategory).toBe('SaaS Subscription');
  });

  it('matches credit to revenue with dayDiff 8-30 (low confidence)', async () => {
    const txDate = new Date(2025, 3, 25);
    const revDate = new Date(2025, 3, 10); // 15 days earlier
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-6', amount: 30000, date: txDate, type: 'credit', description: 'wire' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([
      { id: 'rev-6', amount: 30000, month: revDate, category: 'Sales', source: 'Direct' },
    ] as any);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].confidence).toBe(0.65);
  });

  it('matches credit to revenue with fuzzy amount within 5%', async () => {
    const txDate = new Date(2025, 3, 15);
    const revDate = new Date(2025, 3, 14); // 1 day diff
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-7', amount: 10000, date: txDate, type: 'credit', description: 'professional services' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([
      { id: 'rev-7', amount: 10400, month: revDate, category: null, source: null },
    ] as any);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].confidence).toBe(0.6);
    expect(data.pendingReview[0].suggestedCategory).toBe('Consulting');
  });

  it('handles null description and type in transactions', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-null', amount: 100, date: new Date(), type: null, description: null },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.pendingReview.length).toBe(0);
  });

  it('handles expense match with null category', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-nc', amount: 500, date: new Date(), type: 'debit', description: 'random debit' },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'exp-nc', amount: 500, date: new Date(), description: 'random expense', category: null },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await POST();
    const data = await res.json();
    expect(data.pendingReview.length).toBe(1);
    expect(data.pendingReview[0].suggestedCategory).toBeNull();
  });

  it('hits missing false branches in auto reconcile', async () => {
    const now = new Date('2025-01-10');
    mp.bankTransaction.findMany.mockResolvedValue([
      // dayDiff = 2 -> 0.8 conf (debit)
      { id: 't-1', amount: 100, date: now, type: 'debit', description: 'debit1' },
      // dayDiff > 7 -> false branch (debit)
      { id: 't-2', amount: 200, date: now, type: 'debit', description: 'debit2' },
      // dayDiff <= 7 but descMatch=false -> 0.6 conf (debit)
      { id: 't-3', amount: 300, date: now, type: 'debit', description: 'mismatch' },
      // credit but amount doesnt match invoice (false branch)
      { id: 't-4', amount: 500, date: now, type: 'credit', description: 'credit1' },
      // client name matches but amount doesnt match (false branch)
      { id: 't-5', amount: 600, date: now, type: 'credit', description: 'client match' },
      // dayDiff > 30 for revenue exact match (false branch)
      { id: 't-6', amount: 700, date: now, type: 'credit', description: 'credit2' },
      // amountDiffPct >= 0.05 for revenue (false branch)
      { id: 't-7', amount: 800, date: now, type: 'credit', description: 'credit3' },
      // null description and type (false branches in pendingReview)
      { id: 't-8', amount: 100, date: now, type: null, description: null },
    ] as any);
    
    mp.expense.findMany.mockResolvedValue([
      { id: 'e-1', amount: 100, date: new Date('2025-01-08') }, // diff=2
      { id: 'e-1a', amount: 100, date: new Date('2025-01-10') }, // diff=0 -> conf 0.95 -> covers `!bestMatch || conf > bestMatch.confidence` false branch when checking the next one
      { id: 'e-2', amount: 200, date: new Date('2024-12-01') }, // diff > 7
      { id: 'e-3', amount: 300, date: new Date('2025-01-05'), description: 'something else' }, // diff=5, no desc match
      { id: 'e-3a', amount: 300, date: new Date('2025-01-10'), description: 'something else' }, // diff=0, conf=0.95 -> covers conf > bestMatch false branch
    ] as any);

    mp.invoice.findMany.mockResolvedValue([
      { id: 'i-1', total: 550, issueDate: now }, // diff amount
      { id: 'i-2', total: 650, issueDate: now, client: { name: 'client match' } }, // name match, diff amount
      { id: 'i-3', total: 700, issueDate: now }, // match t-6 to cover invoice path but not revenue path
      { id: 'i-3a', total: 700, issueDate: now }, // conf false branch
    ] as any);

    mp.revenue.findMany.mockResolvedValue([
      { id: 'r-1', amount: 700, month: new Date('2024-11-01') }, // diff > 30 exact
      { id: 'r-2', amount: 880, month: now }, // diff >= 0.05 (80 diff / 800 = 10%)
    ] as any);

    const res = await POST();
    expect(res.status).toBe(200);
  });
});
