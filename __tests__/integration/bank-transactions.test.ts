import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankTransaction: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@prisma/client', () => ({ Prisma: { DateTimeFilter: {} } }));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, PATCH, POST } from '@/app/api/bank/transactions/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mp.bankTransaction?.findMany?.mockResolvedValue?.([]);
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  (mp.bankTransaction.groupBy as any).mockResolvedValue([
    { type:'debit', _sum:{ amount:150000 }, _count:5 },
    { type:'credit', _sum:{ amount:300000 }, _count:3 },
  ]);
});

function req(method='GET', url='http://localhost:3008/api/bank/transactions', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/bank/transactions', () => {
  it('returns paginated transactions with summary', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([
      { id:'bt-1', date:new Date('2025-04-10'), description:'AWS', amount:15000, type:'debit', category:'SaaS', isReconciled:false, vendor:'AWS', bankAccount:{ name:'HDFC', bankName:'HDFC Bank' } },
    ]);
    (mp.bankTransaction.count as any).mockResolvedValue(1);

    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.transactions).toHaveLength(1);
    expect(d.pagination.total).toBe(1);
    expect(d.pagination.page).toBe(1);
    expect(d.summary.totalDebit).toBe(150000);
    expect(d.summary.totalCredit).toBe(300000);
  });

  it('applies type and category filters', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    (mp.bankTransaction.count as any).mockResolvedValue(0);
    await GET(req('GET','http://localhost:3008/api/bank/transactions?type=credit&category=Revenue'));
    expect(mp.bankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: 'credit', category: 'Revenue' }),
    }));
  });

  it('applies date range filters', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    (mp.bankTransaction.count as any).mockResolvedValue(0);
    await GET(req('GET','http://localhost:3008/api/bank/transactions?startDate=2025-04-01&endDate=2025-04-30'));
    expect(mp.bankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ date: expect.objectContaining({ gte: expect.any(Date) }) }),
    }));
  });

  it('filters by isReconciled', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    (mp.bankTransaction.count as any).mockResolvedValue(0);
    await GET(req('GET','http://localhost:3008/api/bank/transactions?isReconciled=false'));
    expect(mp.bankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isReconciled: false }),
    }));
  });

  it('filters by bankAccountId', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    (mp.bankTransaction.count as any).mockResolvedValue(0);
    await GET(req('GET','http://localhost:3008/api/bank/transactions?bankAccountId=ba-1'));
    expect(mp.bankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bankAccountId: 'ba-1' }),
    }));
  });

  it('applies search across description/vendor/reference', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    (mp.bankTransaction.count as any).mockResolvedValue(0);
    await GET(req('GET','http://localhost:3008/api/bank/transactions?search=AWS'));
    expect(mp.bankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.any(Array) }),
    }));
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/bank/transactions', () => {
  it('updates a transaction', async () => {
    (mp.bankTransaction.update as any).mockResolvedValue({ id:'bt-1', category:'Updated' });
    const res = await PATCH(req('PATCH','http://localhost:3008/api/bank/transactions',{ id:'bt-1', category:'Updated' }));
    expect(res.status).toBe(200);
  });

  it('returns 400 without id', async () => {
    const res = await PATCH(req('PATCH','http://localhost:3008/api/bank/transactions',{ category:'Test' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    (mp.bankTransaction.update as any).mockRejectedValue(new Error('not found'));
    const res = await PATCH(req('PATCH','http://localhost:3008/api/bank/transactions',{ id:'bt-1', category:'X' }));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/bank/transactions', () => {
  it('creates a manual transaction', async () => {
    (mp.bankTransaction.create as any).mockResolvedValue({ id:'bt-new', description:'Manual' });
    const res = await POST(req('POST','http://localhost:3008/api/bank/transactions',{
      date:'2025-04-10', description:'Manual Entry', amount:5000, type:'debit', bankAccountId:'ba-1',
    }));
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/bank/transactions',{ description:'Missing' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    (mp.bankTransaction.create as any).mockRejectedValue(new Error('FK violation'));
    const res = await POST(req('POST','http://localhost:3008/api/bank/transactions',{
      date:'2025-04-10', description:'Fail', amount:5000, type:'debit', bankAccountId:'ba-1',
    }));
    expect(res.status).toBe(500);
  });
});
