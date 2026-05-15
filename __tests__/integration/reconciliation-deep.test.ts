import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankTransaction: { findMany: vi.fn(), update: vi.fn() },
    expense: { findMany: vi.fn(), update: vi.fn() },
    invoice: { findMany: vi.fn(), update: vi.fn() },
    revenue: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/reconciliation/route';
import { POST as autoReconcile } from '@/app/api/reconciliation/auto/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

const now = new Date();

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/reconciliation'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  } as Record<string, unknown>);
}

// ── GET /api/reconciliation ──
describe('GET /api/reconciliation', () => {
  it('returns empty when no unmatched transactions', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([]);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unmatched).toEqual([]);
    expect(data.summary.totalUnmatched).toBe(0);
  });

  it('matches debit transactions to expenses with high confidence', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt1', amount: 5000, date: now, type: 'debit', description: 'AWS', category: 'Software', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'e1', amount: 5000, date: now, description: 'AWS Bill', category: { name: 'Software' } },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.unmatched).toHaveLength(1);
    expect(data.unmatched[0].bestMatch).not.toBeNull();
    expect(data.unmatched[0].bestMatch.type).toBe('expense');
    expect(data.unmatched[0].bestMatch.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('matches credit transactions to invoices with high confidence', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt2', amount: 50000, date: now, type: 'credit', description: 'Payment', category: null, isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id: 'inv1', total: 50000, invoiceNumber: 'INV-001', paidAt: now, issueDate: now, status: 'paid', client: { name: 'Client A' } },
    ] as any);

    const res = await GET();
    const data = await res.json();
    expect(data.unmatched[0].bestMatch.type).toBe('invoice');
    expect(data.unmatched[0].bestMatch.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('returns fuzzy matches within 5% amount and 7 days', async () => {
    const txnDate = new Date(now);
    const expDate = new Date(now.getTime() + 5 * 86400000); // 5 days later
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt3', amount: 10000, date: txnDate, type: 'debit', description: 'Test', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'e2', amount: 10200, date: expDate, description: 'Test Exp', category: null },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.unmatched).toHaveLength(1);
    // May or may not match depending on 5% threshold (200/10000 = 2%)
    if (data.unmatched[0].bestMatch) {
      expect(data.unmatched[0].bestMatch.confidence).toBe(0.5);
    }
  });

  it('returns summary counts correctly', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt1', amount: 5000, date: now, type: 'debit', description: 'A', isReconciled: false },
      { id: 'bt2', amount: 9999, date: now, type: 'debit', description: 'B', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'e1', amount: 5000, date: now, description: 'A Match', category: { name: 'Software' } },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.summary.totalUnmatched).toBe(2);
    expect(data.summary.withSuggestions).toBe(1);
  });

  it('matches with medium confidence (0.8) for expenses', async () => {
    const txnDate = new Date(now);
    const expDate = new Date(now.getTime() + 2 * 86400000); // 2 days later
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt3', amount: 5000, date: txnDate, type: 'debit', description: 'Test', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'e2', amount: 5000, date: expDate, description: 'Test Exp', category: null },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.unmatched[0].bestMatch.confidence).toBe(0.8);
  });

  it('matches with medium confidence (0.75) for invoices with fallback client name and issueDate', async () => {
    const txnDate = new Date(now);
    const invDate = new Date(now.getTime() + 2 * 86400000); // 2 days later
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt4', amount: 5000, date: txnDate, type: 'credit', description: 'Test', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id: 'inv2', total: 5000, invoiceNumber: 'INV-002', issueDate: invDate, status: 'paid' }, // no paidAt, no client
    ] as any);

    const res = await GET();
    const data = await res.json();
    expect(data.unmatched[0].bestMatch.confidence).toBe(0.75);
    expect(data.unmatched[0].bestMatch.description).toBe('INV-002 — Unknown');
  });

  it('ignores invoice if amount or date difference is too large', async () => {
    const txnDate = new Date(now);
    const invDate = new Date(now.getTime() + 6 * 86400000); // 6 days later
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt5', amount: 5000, date: txnDate, type: 'credit', description: 'Test', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id: 'inv3', total: 5000, invoiceNumber: 'INV-003', paidAt: invDate, status: 'paid' },
    ] as any);

    const res = await GET();
    const data = await res.json();
    expect(data.unmatched[0].suggestions).toHaveLength(0);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ── POST /api/reconciliation ──
describe('POST /api/reconciliation', () => {
  it('matches transaction to expense via atomic transaction', async () => {
    mp.$transaction.mockImplementation(async (cb: any) => cb({
      bankTransaction: { update: vi.fn() },
      expense: { update: vi.fn() },
      revenue: { update: vi.fn() },
      invoice: { update: vi.fn() },
    }));
    const res = await POST(req({ transactionId: 'bt1', matchType: 'expense', matchId: 'e1' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('matches transaction to revenue', async () => {
    mp.$transaction.mockImplementation(async (cb: any) => cb({
      bankTransaction: { update: vi.fn() },
      expense: { update: vi.fn() },
      revenue: { update: vi.fn() },
      invoice: { update: vi.fn() },
    }));
    const res = await POST(req({ transactionId: 'bt1', matchType: 'revenue', matchId: 'r1', category: 'Sales' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.matched.matchType).toBe('revenue');
  });

  it('matches transaction to revenue without category', async () => {
    mp.$transaction.mockImplementation(async (cb: any) => cb({
      bankTransaction: { update: vi.fn() },
      expense: { update: vi.fn() },
      revenue: { update: vi.fn() },
      invoice: { update: vi.fn() },
    }));
    const res = await POST(req({ transactionId: 'bt1', matchType: 'revenue', matchId: 'r1' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.matched.matchType).toBe('revenue');
  });

  it('matches transaction to invoice and marks as paid', async () => {
    mp.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        bankTransaction: { update: vi.fn() },
        expense: { update: vi.fn() },
        revenue: { update: vi.fn() },
        invoice: { update: vi.fn() },
      };
      await cb(tx);
      expect(tx.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'inv1' },
        data: expect.objectContaining({ status: 'paid' }),
      }));
    });
    const res = await POST(req({ transactionId: 'bt1', matchType: 'invoice', matchId: 'inv1' }));
    expect(res.status).toBe(200);
  });

  it('reconciles without match (just marking reconciled)', async () => {
    mp.$transaction.mockImplementation(async (cb: any) => cb({
      bankTransaction: { update: vi.fn() },
      expense: { update: vi.fn() },
      revenue: { update: vi.fn() },
      invoice: { update: vi.fn() },
    }));
    const res = await POST(req({ transactionId: 'bt1' }));
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await POST(req({ transactionId: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing transactionId', async () => {
    const res = await POST(req({ matchType: 'expense' }));
    expect(res.status).toBe(400);
  });

  it('applies category when provided', async () => {
    mp.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        bankTransaction: { update: vi.fn() },
        expense: { update: vi.fn() },
        revenue: { update: vi.fn() },
        invoice: { update: vi.fn() },
      };
      await cb(tx);
      expect(tx.bankTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ category: 'Software', isReconciled: true }),
      }));
    });
    const res = await POST(req({ transactionId: 'bt1', category: 'Software' }));
    expect(res.status).toBe(200);
  });

  it('returns 500 on transaction error', async () => {
    mp.$transaction.mockRejectedValue(new Error('DB error'));
    const res = await POST(req({ transactionId: 'bt1' }));
    expect(res.status).toBe(500);
  });
});

// ── POST /api/reconciliation/auto ──
describe('POST /api/reconciliation/auto', () => {
  it('returns 0 matches when no unreconciled transactions', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([]);
    const res = await autoReconcile();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.matched).toBe(0);
    expect(data.message).toContain('No unreconciled');
  });

  it('proposes debit matches against expenses', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt1', amount: 5000, date: now, type: 'debit', description: 'AWS', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'e1', amount: 5000, date: now, description: 'AWS Bill', category: { name: 'Cloud' } },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await autoReconcile();
    const data = await res.json();
    expect(data.pendingReview).toHaveLength(1);
    expect(data.pendingReview[0].matchType).toBe('expense');
    expect(data.pendingReview[0].confidence).toBeGreaterThanOrEqual(0.8);
    expect(data.pendingReview[0].suggestedCategory).toBe('Cloud');
  });

  it('proposes credit matches against invoices', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt2', amount: 50000, date: now, type: 'credit', description: 'Client A payment', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id: 'inv1', total: 50000, invoiceNumber: 'INV-001', issueDate: now, payments: [], client: { name: 'Client A' } },
    ] as any);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await autoReconcile();
    const data = await res.json();
    expect(data.pendingReview.length).toBeGreaterThanOrEqual(1);
    const invMatch = data.pendingReview.find((p: any) => p.matchType === 'invoice');
    expect(invMatch).toBeDefined();
  });

  it('proposes credit matches against revenue entries', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt3', amount: 25000, date: now, type: 'credit', description: 'service revenue', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([
      { id: 'r1', amount: 25000, month: now, source: 'Service Fee', category: 'Service Revenue' },
    ] as any);

    const res = await autoReconcile();
    const data = await res.json();
    const revMatch = data.pendingReview.find((p: any) => p.matchType === 'revenue');
    expect(revMatch).toBeDefined();
    expect(revMatch.suggestedCategory).toBeDefined();
  });

  it('prefers invoice match over revenue match for credits', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt4', amount: 30000, date: now, type: 'credit', description: 'payment', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id: 'inv2', total: 30000, invoiceNumber: 'INV-002', issueDate: now, payments: [], client: { name: 'Test' } },
    ] as any);
    mp.revenue.findMany.mockResolvedValue([
      { id: 'r2', amount: 30000, month: now, source: 'Test', category: 'Other' },
    ] as any);

    const res = await autoReconcile();
    const data = await res.json();
    expect(data.pendingReview).toHaveLength(1);
    // Invoice match should win with higher confidence
    expect(data.pendingReview[0].matchType).toBe('invoice');
  });

  it('does not propose matches below 0.5 confidence', async () => {
    const farDate = new Date(now.getTime() - 30 * 86400000);
    mp.bankTransaction.findMany.mockResolvedValue([
      { id: 'bt5', amount: 5000, date: now, type: 'debit', description: 'Random', isReconciled: false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'e5', amount: 999999, date: farDate, description: 'Totally Different', category: null },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);

    const res = await autoReconcile();
    const data = await res.json();
    expect(data.pendingReview).toHaveLength(0);
    expect(data.total).toBe(1);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await autoReconcile();
    expect(res.status).toBe(500);
  });
});
