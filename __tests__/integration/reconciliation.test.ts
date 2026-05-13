import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankTransaction: { findMany: vi.fn(), update: vi.fn() },
    expense: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    invoice: { findMany: vi.fn(), update: vi.fn() },
    revenue: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/reconciliation/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method="GET", url="http://localhost:3008/api/test", body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/reconciliation', () => {
  it('returns unmatched transactions with match suggestions for debits', async () => {
    const txnDate = new Date('2025-04-10');
    mp.bankTransaction.findMany.mockResolvedValue([
      { id:'bt-1', date:txnDate, description:'AWS Payment', amount:15000, type:'debit', category:'SaaS', isReconciled:false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id:'e-1', description:'AWS Monthly', amount:15000, date:new Date('2025-04-10'), category:{ name:'SaaS' } },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);

    const res = await GET();
    const d = await res.json();

    expect(res.status).toBe(200);
    expect(d.unmatched).toHaveLength(1);
    expect(d.unmatched[0].suggestions).toHaveLength(1);
    expect(d.unmatched[0].bestMatch.type).toBe('expense');
    expect(d.unmatched[0].bestMatch.confidence).toBeGreaterThanOrEqual(0.9);
    expect(d.summary.totalUnmatched).toBe(1);
    expect(d.summary.withSuggestions).toBe(1);
  });

  it('matches credits against invoices', async () => {
    const txnDate = new Date('2025-04-15');
    mp.bankTransaction.findMany.mockResolvedValue([
      { id:'bt-2', date:txnDate, description:'Payment Received', amount:50000, type:'credit', isReconciled:false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { id:'inv-1', invoiceNumber:'INV-001', total:50000, paidAt:new Date('2025-04-15'), issueDate:new Date('2025-04-01'), client:{ name:'Acme' }, status:'paid' },
    ] as any);

    const res = await GET();
    const d = await res.json();

    expect(d.unmatched[0].bestMatch.type).toBe('invoice');
    expect(d.unmatched[0].bestMatch.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('returns empty when no unmatched transactions', async () => {
    mp.bankTransaction.findMany.mockResolvedValue([]);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([]);

    const res = await GET();
    const d = await res.json();

    expect(d.unmatched).toHaveLength(0);
    expect(d.summary.totalUnmatched).toBe(0);
  });

  it('handles fuzzy amount matches (5% tolerance, lower confidence)', async () => {
    const txnDate = new Date('2025-04-10');
    mp.bankTransaction.findMany.mockResolvedValue([
      { id:'bt-3', date:txnDate, description:'Office rent', amount:100000, type:'debit', isReconciled:false },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id:'e-2', description:'Rent', amount:99000, date:new Date('2025-04-08'), category:null },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([]);

    const res = await GET();
    const d = await res.json();

    expect(d.unmatched[0].suggestions).toHaveLength(1);
    expect(d.unmatched[0].bestMatch.confidence).toBe(0.5);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/reconciliation', () => {
  it('reconciles a transaction to an expense', async () => {
    mp.$transaction.mockImplementation(async (cb:any) => cb({
      bankTransaction: { update: vi.fn().mockResolvedValue({}) },
      expense: { update: vi.fn().mockResolvedValue({}) },
      invoice: { update: vi.fn().mockResolvedValue({}) },
      revenue: { update: vi.fn().mockResolvedValue({}) },
    }));

    const res = await POST(req('POST','http://localhost:3008/api/reconciliation', {
      transactionId:'bt-1', matchType:'expense', matchId:'e-1',
    }));
    const d = await res.json();

    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
    expect(d.matched.transactionId).toBe('bt-1');
  });

  it('reconciles a transaction to an invoice', async () => {
    mp.$transaction.mockImplementation(async (cb:any) => cb({
      bankTransaction: { update: vi.fn().mockResolvedValue({}) },
      expense: { update: vi.fn().mockResolvedValue({}) },
      invoice: { update: vi.fn().mockResolvedValue({}) },
      revenue: { update: vi.fn().mockResolvedValue({}) },
    }));

    const res = await POST(req('POST','http://localhost:3008/api/reconciliation', {
      transactionId:'bt-2', matchType:'invoice', matchId:'inv-1',
    }));
    expect(res.status).toBe(200);
  });

  it('reconciles a transaction to revenue', async () => {
    mp.$transaction.mockImplementation(async (cb:any) => cb({
      bankTransaction: { update: vi.fn().mockResolvedValue({}) },
      expense: { update: vi.fn().mockResolvedValue({}) },
      invoice: { update: vi.fn().mockResolvedValue({}) },
      revenue: { update: vi.fn().mockResolvedValue({}) },
    }));

    const res = await POST(req('POST','http://localhost:3008/api/reconciliation', {
      transactionId:'bt-3', matchType:'revenue', matchId:'rev-1', category:'Sales',
    }));
    expect(res.status).toBe(200);
  });

  it('returns 400 when transactionId missing', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/reconciliation', {}));
    expect(res.status).toBe(400);
  });

  it('returns 500 on transaction failure', async () => {
    mp.$transaction.mockRejectedValue(new Error('Deadlock'));
    const res = await POST(req('POST','http://localhost:3008/api/reconciliation', { transactionId:'bt-1' }));
    expect(res.status).toBe(500);
  });
});
