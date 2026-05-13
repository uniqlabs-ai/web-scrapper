import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn(), groupBy: vi.fn(), create: vi.fn() },
    invoice: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    revenue: { findMany: vi.fn(), create: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    account: { update: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/founder-os-jwt', () => ({ extractFounderOSToken: vi.fn().mockReturnValue(null) }));
vi.mock('@/lib/runway', () => ({
  getRunway: vi.fn().mockResolvedValue({ runwayMonths: 12, cashLeft: 1000000 }),
  getBurnRate: vi.fn().mockResolvedValue({ currentMonth: 100000, average: 90000 }),
  getRevenueData: vi.fn().mockResolvedValue({ mrr: 200000, arr: 2400000, trend: [] }),
}));
vi.mock('@/lib/financial-intelligence', () => ({
  generatePnL: vi.fn().mockReturnValue({ revenue: 200000, expenses: 100000, netProfit: 100000 }),
  projectCashFlow: vi.fn().mockReturnValue({ projectedRunway: 12, monthlyProjection: [] }),
}));
vi.mock('uuid', () => ({ v4: vi.fn().mockReturnValue('mock-uuid') }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));
vi.mock('@/lib/gst', () => ({
  calculateLineItemTotal: vi.fn().mockImplementation((qty: number, price: number, rate: number, interState: boolean) => ({
    quantity: qty, unitPrice: price, amount: qty * price,
    cgst: interState ? 0 : (qty * price * rate / 100 / 2),
    sgst: interState ? 0 : (qty * price * rate / 100 / 2),
    igst: interState ? (qty * price * rate / 100) : 0,
    total: qty * price * (1 + rate / 100),
  })),
}));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/v1/copilot/query/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function req(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/v1/copilot/query'), {
    method:'POST', body:JSON.stringify(body), headers:{'Content-Type':'application/json'},
  });
}

describe('POST /api/v1/copilot/query', () => {
  it('returns 400 when query is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('handles getRunway query', async () => {
    (mp.bankAccount.findMany as any).mockResolvedValue([{ currentBalance: 1000000 }]);
    (mp.expense.findMany as any).mockResolvedValue([]);
    (mp.revenue.findMany as any).mockResolvedValue([]);
    const res = await POST(req({ query: 'getRunway' }));
    expect(res.status).toBe(200);
  });

  it('handles getExpenses query', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'e1', description:'AWS', amount:15000, date:new Date(), category:{ name:'SaaS' } },
    ]);
    const res = await POST(req({ query: 'getExpenses' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.data.expenses).toBeDefined();
  });

  it('handles getInvoices query', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([
      { id:'inv-1', invoiceNumber:'INV-001', total:100000, status:'sent', client:{ name:'Acme' }, payments:[] },
    ]);
    const res = await POST(req({ query: 'getInvoices' }));
    expect(res.status).toBe(200);
  });

  it('handles getFinancialHealth query', async () => {
    (mp.bankAccount.findMany as any).mockResolvedValue([{ currentBalance: 1000000 }]);
    (mp.expense.findMany as any).mockResolvedValue([]);
    (mp.revenue.findMany as any).mockResolvedValue([]);
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await POST(req({ query: 'getFinancialHealth' }));
    expect(res.status).toBe(200);
  });

  it('handles getRevenueByClient query', async () => {
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount: 100000, clientId: 'c1', type: 'recurring', source: 'SaaS', month: new Date() },
    ]);
    const res = await POST(req({ query: 'getRevenueByClient' }));
    expect(res.status).toBe(200);
  });

  it('returns 400 for unknown query', async () => {
    const res = await POST(req({ query: 'unknownQuery' }));
    expect(res.status).toBe(400);
  });

  it('handles getCashFlowProjection query', async () => {
    const res = await POST(req({ query: 'getCashFlowProjection', params: { months: 6 } }));
    expect(res.status).toBe(200);
  });

  it('handles getCostByDepartment query', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'e1', amount:15000, department:'Engineering', date:new Date(), category:null },
      { id:'e2', amount:8000, department:'Marketing', date:new Date(), category:null },
      { id:'e3', amount:5000, department:'Engineering', date:new Date(), category:null },
    ]);
    const res = await POST(req({ query: 'getCostByDepartment' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.data.departments).toBeDefined();
    expect(d.data.departments.length).toBeGreaterThan(0);
  });

  it('handles getExpenses with date filter params', async () => {
    (mp.expense.findMany as any).mockResolvedValue([]);
    const res = await POST(req({
      query: 'getExpenses',
      params: { from: '2025-04-01', to: '2025-04-30', category: 'cat-1' },
    }));
    expect(res.status).toBe(200);
  });

  it('handles createInvoice action', async () => {
    (mp.invoice.count as any).mockResolvedValue(5);
    (mp.invoice.create as any).mockResolvedValue({
      id: 'inv-new', invoiceNumber: 'INV-0006', total: 11800,
      lineItems: [{ id: 'li-1' }], client: null,
    });

    const res = await POST(req({
      query: 'createInvoice',
      params: {
        dueDate: '2025-05-15',
        lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 10000, gstRate: 18 }],
      },
    }));
    expect(res.status).toBe(201);
    const d = await res.json();
    expect(d.success).toBe(true);
  });

  it('returns 400 for createInvoice without params', async () => {
    const res = await POST(req({ query: 'createInvoice', params: {} }));
    expect(res.status).toBe(400);
  });

  it('handles logExpense action', async () => {
    (mp.expense.create as any).mockResolvedValue({
      id: 'exp-new', description: 'AWS', amount: 15000, category: null,
    });
    (mp.account.update as any).mockResolvedValue({});

    const res = await POST(req({
      query: 'logExpense',
      params: { description: 'AWS Bill', amount: 15000, accountId: 'acct-1', date: '2025-04-15' },
    }));
    expect(res.status).toBe(201);
  });

  it('returns 400 for logExpense without params', async () => {
    const res = await POST(req({ query: 'logExpense', params: {} }));
    expect(res.status).toBe(400);
  });

  it('handles getInvoices with status filter', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await POST(req({ query: 'getInvoices', params: { status: 'overdue' } }));
    expect(res.status).toBe(200);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req({ query: 'getRunway' }));
    expect(res.status).toBe(500);
  });
});
