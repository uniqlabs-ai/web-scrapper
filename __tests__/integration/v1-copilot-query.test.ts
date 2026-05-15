import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    expense: { findMany: vi.fn(), create: vi.fn() },
    revenue: { findMany: vi.fn() },
    account: { update: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/founder-os-jwt', () => ({ extractFounderOSToken: vi.fn() }));

// Mock financial logic
vi.mock('@/lib/runway', () => ({
  getRunway: vi.fn().mockResolvedValue({ runwayMonths: 12 }),
  getBurnRate: vi.fn().mockResolvedValue({ currentMonth: 5000, trend: 'stable' }),
  getRevenueData: vi.fn().mockResolvedValue({ currentMRR: 10000, currentARR: 120000, growth: 10 }),
}));
vi.mock('@/lib/financial-intelligence', () => ({
  generatePnL: vi.fn().mockResolvedValue({ profitMargin: 25 }),
  projectCashFlow: vi.fn().mockResolvedValue({ projectedRunway: 12 }),
}));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/v1/copilot/query/route';
import { extractFounderOSToken } from '@/lib/founder-os-jwt';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mJwt = vi.mocked(extractFounderOSToken);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mJwt.mockReturnValue(null);
  (mp.user.findFirst as any).mockResolvedValue({ organizationId: 'org-1' });
});

function req(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/v1/copilot/query'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/v1/copilot/query', () => {
  it('returns 400 if query is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('uses orgId from body if provided', async () => {
    // resolveIdentity with orgId still calls requireTenant to get userId
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await POST(req({ query: 'getRunway', orgId: 'org-custom' }));
    expect(res.status).toBe(200);
  });

  it('uses JWT token if provided', async () => {
    mJwt.mockReturnValue({ sub: 'user-jwt', organizationId: 'org-jwt' });
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await POST(req({ query: 'getRunway' }));
    expect(res.status).toBe(200);
  });

  it('handles getRunway', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([{ total: 1000, status: 'sent' }]);
    const res = await POST(req({ query: 'getRunway' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.runway.runwayMonths).toBe(12);
  });

  it('handles getExpenses', async () => {
    (mp.expense.findMany as any).mockResolvedValue([{ amount: 500, date: new Date() }]);
    const res = await POST(req({ query: 'getExpenses', params: { category: 'cat1', from: '2025-01-01', to: '2025-01-31' } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.expenses.length).toBe(1);
  });

  it('handles getInvoices', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([{ total: 1000, status: 'sent' }]);
    const res = await POST(req({ query: 'getInvoices', params: { status: 'sent' } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.summary.outstandingAmount).toBe(1000);
  });

  it('handles getCashFlowProjection', async () => {
    const res = await POST(req({ query: 'getCashFlowProjection', params: { months: 3 } }));
    expect(res.status).toBe(200);
  });

  it('handles getCostByDepartment', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 5000, department: 'Engineering' },
      { amount: 2000, department: 'Marketing' },
      { amount: 1000 } // Uncategorized
    ]);
    const res = await POST(req({ query: 'getCostByDepartment', params: { from: '2025-01-01', to: '2025-01-31' } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.departments[0].department).toBe('Engineering');
  });

  it('handles getFinancialHealth', async () => {
    (mp.invoice.count as any).mockResolvedValue(15); // Unpaid count
    const res = await POST(req({ query: 'getFinancialHealth' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.score).toBeDefined();
    expect(data.data.recommendations).toBeInstanceOf(Array);
  });

  it('handles getRevenueByClient', async () => {
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount: 5000, clientId: 'c1', type: 'recurring', client: { name: 'Client 1' } },
      { amount: 2000, type: 'one-time' }, // Unattributed
    ]);
    const res = await POST(req({ query: 'getRevenueByClient' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.clients.length).toBe(2);
  });

  it('handles createInvoice', async () => {
    (mp.invoice.count as any).mockResolvedValue(5);
    (mp.invoice.create as any).mockResolvedValue({ id: 'inv1' });
    const res = await POST(req({ 
      query: 'createInvoice', 
      params: { 
        dueDate: '2025-12-31', 
        lineItems: [{ description: 'Test', quantity: 1, unitPrice: 1000, gstRate: 18 }] 
      } 
    }));
    expect(res.status).toBe(201);
  });

  it('returns 400 for createInvoice if params missing', async () => {
    const res = await POST(req({ query: 'createInvoice' }));
    expect(res.status).toBe(400);
  });

  it('handles logExpense', async () => {
    (mp.expense.create as any).mockResolvedValue({ id: 'exp1' });
    const res = await POST(req({ 
      query: 'logExpense', 
      params: { description: 'AWS', amount: 500, accountId: 'acc1', date: '2025-01-01' } 
    }));
    expect(res.status).toBe(201);
    expect(mp.account.update).toHaveBeenCalled();
  });

  it('returns 400 for logExpense if params missing', async () => {
    const res = await POST(req({ query: 'logExpense' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown query', async () => {
    const res = await POST(req({ query: 'unknownQuery' }));
    expect(res.status).toBe(400);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req({ query: 'getRunway' }));
    expect(res.status).toBe(500);
  });
});
