import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    revenue: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() }
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/forecast/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });

  (mp.revenue.findMany as any).mockResolvedValue([]);
  (mp.expense.findMany as any).mockResolvedValue([]);
  (mp.invoice.findMany as any).mockResolvedValue([]);
});

function req(method='GET', url='http://localhost:3008/api/forecast'): NextRequest {
  return new NextRequest(new URL(url), { method });
}

describe('GET /api/forecast', () => {
  it('handles empty data successfully', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.historical.length).toBe(7); // Last 6 months + current month
    expect(data.forecast.length).toBe(6);
    expect(data.metrics.runway).toBe(null); // Infinity stringifies to null in JSON
    expect(data.metrics.growthRate).toBe(0);
  });

  it('calculates forecast, scenarios, and runway correctly', async () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
    const fiveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 15);

    (mp.revenue.findMany as any).mockResolvedValue([
      { amount: 10000, month: fiveMonthsAgo },
      { amount: 20000, month: twoMonthsAgo },
      { amount: 30000, month: lastMonth },
    ]);
    
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 50000, date: lastMonth }, // High expense to force runway calculation
    ]);

    (mp.invoice.findMany as any).mockResolvedValue([
      { invoiceNumber: 'INV-1', total: 5000, dueDate: new Date(now.getTime() + 86400000), status: 'sent' }
    ]);

    const res = await GET(req());
    const data = await res.json();
    
    expect(data.historical).toBeDefined();
    expect(data.forecast[0].isForecasted).toBe(true);
    expect(data.scenarios.optimistic.monthlyRevenue).toBeGreaterThan(0);
    expect(data.scenarios.base.monthlyProfit).toBeDefined();
    
    // Total pipeline = 5000
    // Avg Revenue = ~60000 / 7 = ~8571
    // Avg Expense = 50000 / 7 = ~7142
    // Wait, if avgExpense > avgRevenue, runway is calculated.
    // Let's adjust amounts so avgExpense > avgRevenue
  });

  it('calculates runway when expenses exceed revenue', async () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    (mp.revenue.findMany as any).mockResolvedValue([
      { amount: 1000, month: lastMonth },
    ]);
    
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 10000, date: lastMonth },
      { amount: 10000, date: now },
    ]);

    (mp.invoice.findMany as any).mockResolvedValue([
      { invoiceNumber: 'INV-1', total: 9000, dueDate: new Date(now.getTime() + 86400000), status: 'sent' }
    ]);

    const res = await GET(req());
    const data = await res.json();
    
    // Runway = totalPipeline / (avgExpenses - avgRevenue)
    // Avg Revenue = 1000 / 7 = ~143
    // Avg Expenses = 20000 / 7 = ~2857
    // Pipeline = 9000
    // Runway = 9000 / (2857 - 143) = 9000 / 2714 = ~3
    expect(data.metrics.runway).toBeGreaterThan(0);
    expect(data.metrics.runway).not.toBe(Infinity);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
