import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    revenue: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/forecast/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const now = new Date();

function monthDate(offset: number) {
  return new Date(now.getFullYear(), now.getMonth() + offset, 15);
}

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mp.invoice.findMany.mockResolvedValue([]);
});

describe('GET /api/forecast', () => {
  it('returns forecast data with empty dataset', async () => {
    mp.revenue.findMany.mockResolvedValue([]);
    mp.expense.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.historical).toBeDefined();
    expect(data.forecast).toBeDefined();
    expect(data.scenarios).toBeDefined();
    expect(data.pipeline).toBeDefined();
    expect(data.metrics).toBeDefined();
    expect(data.forecast).toHaveLength(6);
  });

  it('calculates historical monthly data correctly', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 100000, month: monthDate(-3) },
      { amount: 120000, month: monthDate(-2) },
      { amount: 150000, month: monthDate(-1) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 50000, date: monthDate(-3) },
      { amount: 60000, date: monthDate(-2) },
      { amount: 70000, date: monthDate(-1) },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.historical.length).toBeGreaterThan(0);
    const months = data.historical.filter((h: any) => h.revenue > 0);
    expect(months.length).toBeGreaterThan(0);
  });

  it('generates linear forecast for 6 months', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 100000, month: monthDate(-5) },
      { amount: 110000, month: monthDate(-4) },
      { amount: 120000, month: monthDate(-3) },
      { amount: 130000, month: monthDate(-2) },
      { amount: 140000, month: monthDate(-1) },
      { amount: 150000, month: monthDate(0) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 50000, date: monthDate(-3) },
      { amount: 55000, date: monthDate(-2) },
      { amount: 60000, date: monthDate(-1) },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.forecast).toHaveLength(6);
    for (const f of data.forecast) {
      expect(f.isForecasted).toBe(true);
      expect(f.revenue).toBeGreaterThanOrEqual(0);
    }
  });

  it('calculates three scenarios correctly', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 100000, month: monthDate(-1) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 60000, date: monthDate(-1) },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.scenarios.optimistic.monthlyRevenue).toBeGreaterThan(data.scenarios.base.monthlyRevenue);
    expect(data.scenarios.conservative.monthlyRevenue).toBeLessThan(data.scenarios.base.monthlyRevenue);
    expect(data.scenarios.optimistic.monthlyExpenses).toBeLessThan(data.scenarios.base.monthlyExpenses);
  });

  it('includes pipeline from pending invoices', async () => {
    mp.revenue.findMany.mockResolvedValue([]);
    mp.expense.findMany.mockResolvedValue([]);
    mp.invoice.findMany.mockResolvedValue([
      { invoiceNumber: 'INV-001', total: 50000, dueDate: new Date(now.getTime() + 10 * 86400000), status: 'sent' },
      { invoiceNumber: 'INV-002', total: 30000, dueDate: new Date(now.getTime() + 20 * 86400000), status: 'partial' },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.pipeline.items).toHaveLength(2);
    expect(data.pipeline.total).toBe(80000);
  });

  it('calculates growth rate from first vs second half', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 50000, month: monthDate(-5) },
      { amount: 50000, month: monthDate(-4) },
      { amount: 50000, month: monthDate(-3) },
      { amount: 100000, month: monthDate(-2) },
      { amount: 100000, month: monthDate(-1) },
      { amount: 100000, month: monthDate(0) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([]);
    const res = await GET();
    const data = await res.json();
    expect(data.metrics.growthRate).toBeGreaterThan(0); // positive growth
  });

  it('calculates runway when expenses > revenue', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 50000, month: monthDate(-1) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 100000, date: monthDate(-1) },
    ] as any);
    mp.invoice.findMany.mockResolvedValue([
      { invoiceNumber: 'INV-1', total: 200000, dueDate: new Date(now.getTime() + 10 * 86400000), status: 'sent' },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.metrics.runway).toBeDefined();
    expect(typeof data.metrics.runway).toBe('number');
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
