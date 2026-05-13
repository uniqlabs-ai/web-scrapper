import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { invoice: { findMany: vi.fn() }, expense: { aggregate: vi.fn() } } }));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/runway', () => ({ getRunway: vi.fn(), getBurnRate: vi.fn(), getRevenueData: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { getRunway, getBurnRate, getRevenueData } from '@/lib/runway';
import { GET } from '@/app/api/dashboard/route';

import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma); const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  vi.mocked(getRunway).mockResolvedValue({ cashInBank:500000, monthlyBurn:150000, runwayMonths:3.3, projectedRunOutDate:null } as any);
  vi.mocked(getBurnRate).mockResolvedValue({ currentMonth:150000, previousMonth:130000, average3Month:140000, trend:'increasing' } as any);
  vi.mocked(getRevenueData).mockResolvedValue({ currentMRR:200000, currentARR:2400000, previousMRR:180000, growth:11.1, totalMonthlyRevenue:220000, history:[] } as any);
  mp.invoice.findMany.mockResolvedValue([{id:'i1',total:50000},{id:'i2',total:100000}] as any);
  mp.expense.aggregate.mockResolvedValue({_sum:{amount:120000}} as any);
});

describe('GET /api/dashboard', () => {
  it('returns KPIs', async () => {
    const res = await GET(); const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.monthlyRevenue).toBe(200000);
    expect(d.outstandingInvoices.count).toBe(2);
    expect(d.totalExpensesThisMonth).toBe(120000);
  });

  it('handles null expense sum', async () => {
    mp.expense.aggregate.mockResolvedValue({_sum:{amount:null}} as any);
    const res = await GET(); const d = await res.json();
    expect(d.totalExpensesThisMonth).toBe(0);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('Auth down'));
    const res = await GET(); expect(res.status).toBe(500);
  });
});
