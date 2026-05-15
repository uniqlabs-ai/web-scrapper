import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — factory must not reference outer variables
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankAccount: { findMany: vi.fn() },
    expense: { aggregate: vi.fn() },
    revenue: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getRunway, getBurnRate, getRevenueData } from '@/lib/runway';
import { mockPrisma } from '../helpers/prisma-mock';

const mockedPrisma = mockPrisma(prisma);

describe('getRunway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates runway from cash and burn rate', async () => {
    mockedPrisma.bankAccount.findMany.mockResolvedValue([
      { currentBalance: 100000 },
      { currentBalance: 50000 },
    ] as any);
    mockedPrisma.expense.aggregate.mockResolvedValue({
      _sum: { amount: 30000 },
    } as any);

    const result = await getRunway('user-1', 'org-1');

    expect(result.cashInBank).toBe(150000);
    expect(result.monthlyBurn).toBeGreaterThan(0);
    expect(result.runwayMonths).toBeGreaterThan(0);
    expect(result.projectedRunOutDate).not.toBeNull();
  });

  it('returns Infinity runway when no expenses', async () => {
    mockedPrisma.bankAccount.findMany.mockResolvedValue([
      { currentBalance: 100000 },
    ] as any);
    mockedPrisma.expense.aggregate.mockResolvedValue({
      _sum: { amount: null },
    } as any);

    const result = await getRunway('user-1', 'org-1');

    expect(result.cashInBank).toBe(100000);
    expect(result.monthlyBurn).toBe(0);
    expect(result.runwayMonths).toBe(Infinity);
    expect(result.projectedRunOutDate).toBeNull();
  });

  it('returns 0 runway when no cash and has expenses', async () => {
    mockedPrisma.bankAccount.findMany.mockResolvedValue([] as any);
    mockedPrisma.expense.aggregate.mockResolvedValue({
      _sum: { amount: 10000 },
    } as any);

    const result = await getRunway('user-1', 'org-1');

    expect(result.cashInBank).toBe(0);
    expect(result.runwayMonths).toBe(0);
  });
});

describe('getBurnRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates current, previous, and 3-month average burn', async () => {
    mockedPrisma.expense.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 15000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 12000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 42000 } } as any);

    const result = await getBurnRate('user-1', 'org-1');

    expect(result.currentMonth).toBe(15000);
    expect(result.previousMonth).toBe(12000);
    expect(result.average3Month).toBe(14000);
  });

  it('detects increasing trend when >10% growth', async () => {
    mockedPrisma.expense.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 20000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 10000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 40000 } } as any);

    const result = await getBurnRate('user-1', 'org-1');
    expect(result.trend).toBe('increasing');
  });

  it('detects decreasing trend when <90% of previous', async () => {
    mockedPrisma.expense.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 5000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 20000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 35000 } } as any);

    const result = await getBurnRate('user-1', 'org-1');
    expect(result.trend).toBe('decreasing');
  });

  it('detects stable trend within ±10%', async () => {
    mockedPrisma.expense.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 10500 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 10000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 31000 } } as any);

    const result = await getBurnRate('user-1', 'org-1');
    expect(result.trend).toBe('stable');
  });

  it('handles null amounts gracefully', async () => {
    mockedPrisma.expense.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null } } as any)
      .mockResolvedValueOnce({ _sum: { amount: null } } as any)
      .mockResolvedValueOnce({ _sum: { amount: null } } as any);

    const result = await getBurnRate('user-1', 'org-1');
    expect(result.currentMonth).toBe(0);
    expect(result.previousMonth).toBe(0);
    expect(result.average3Month).toBe(0);
    expect(result.trend).toBe('stable');
  });
});

describe('getRevenueData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates MRR, ARR, and growth', async () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    mockedPrisma.revenue.findMany.mockResolvedValue([
      { month: prevMonth, amount: 5000, type: 'recurring' },
      { month: currentMonth, amount: 6000, type: 'recurring' },
      { month: currentMonth, amount: 2000, type: 'one-time' },
    ] as any);

    const result = await getRevenueData('user-1', 'org-1');

    expect(result.currentMRR).toBe(6000);
    expect(result.currentARR).toBe(72000);
    expect(result.previousMRR).toBe(5000);
    expect(result.growth).toBe(20);
    expect(result.totalMonthlyRevenue).toBe(8000);
  });

  it('returns 0 growth when no previous MRR', async () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);

    mockedPrisma.revenue.findMany.mockResolvedValue([
      { month: currentMonth, amount: 5000, type: 'recurring' },
    ] as any);

    const result = await getRevenueData('user-1', 'org-1');
    expect(result.growth).toBe(0);
    expect(result.previousMRR).toBe(0);
  });

  it('returns empty history when no revenues', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);

    const result = await getRevenueData('user-1', 'org-1');
    expect(result.currentMRR).toBe(0);
    expect(result.currentARR).toBe(0);
    expect(result.history).toEqual([]);
    expect(result.totalMonthlyRevenue).toBe(0);
  });

  it('aggregates history by month correctly', async () => {
    const month1 = new Date(2026, 0, 15);
    const month2 = new Date(2026, 1, 15);

    mockedPrisma.revenue.findMany.mockResolvedValue([
      { month: month1, amount: 3000, type: 'recurring' },
      { month: month1, amount: 1000, type: 'one-time' },
      { month: month2, amount: 4000, type: 'recurring' },
    ] as any);

    const result = await getRevenueData('user-1', 'org-1');

    expect(result.history.length).toBe(2);
    expect(result.history[0].amount).toBe(4000);
    expect(result.history[1].amount).toBe(4000);
  });
});
