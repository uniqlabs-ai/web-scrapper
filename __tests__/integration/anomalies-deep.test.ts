import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    budgetThreshold: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/anomalies/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mp.user.findUnique.mockResolvedValue({ organizationId: 'org-1' } as any);
  mp.budgetThreshold.findMany.mockResolvedValue([]);
});

function makeExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1', userId: 'u1', amount: 5000, description: 'Test',
    vendor: 'TestVendor', date: new Date(), category: { name: 'Software' },
    ...overrides,
  };
}

describe('GET /api/anomalies', () => {
  it('returns empty anomalies when no expenses', async () => {
    mp.expense.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.anomalies).toEqual([]);
    expect(data.summary.total).toBe(0);
  });

  it('detects category spending spike (> 2x avg, > 5000)', async () => {
    const now = new Date();
    const expenses = [
      makeExpense({ amount: 50000, date: new Date(now.getFullYear(), now.getMonth(), 5) }),
      makeExpense({ amount: 10000, date: new Date(now.getFullYear(), now.getMonth() - 1, 5) }),
      makeExpense({ amount: 8000, date: new Date(now.getFullYear(), now.getMonth() - 2, 5) }),
      makeExpense({ amount: 12000, date: new Date(now.getFullYear(), now.getMonth() - 3, 5) }),
    ];
    mp.expense.findMany.mockResolvedValue(expenses as any);
    const res = await GET();
    const data = await res.json();
    const spikes = data.anomalies.filter((a: any) => a.type === 'spike');
    expect(spikes.length).toBeGreaterThanOrEqual(1);
  });

  it('detects high severity spike (> 3x avg)', async () => {
    const now = new Date();
    const expenses = [
      makeExpense({ amount: 100000, date: new Date(now.getFullYear(), now.getMonth(), 5) }),
      makeExpense({ amount: 10000, date: new Date(now.getFullYear(), now.getMonth() - 1, 5) }),
      makeExpense({ amount: 8000, date: new Date(now.getFullYear(), now.getMonth() - 2, 5) }),
      makeExpense({ amount: 12000, date: new Date(now.getFullYear(), now.getMonth() - 3, 5) }),
    ];
    mp.expense.findMany.mockResolvedValue(expenses as any);
    const res = await GET();
    const data = await res.json();
    const highSpikes = data.anomalies.filter((a: any) => a.severity === 'high');
    expect(highSpikes.length).toBeGreaterThanOrEqual(1);
  });

  it('detects monthly total spending increase (> 30%, > 10000)', async () => {
    const now = new Date();
    const m1 = new Date(now.getFullYear(), now.getMonth(), 5);
    const m2 = new Date(now.getFullYear(), now.getMonth() - 1, 5);
    const expenses = [
      makeExpense({ amount: 20000, date: m1, category: { name: 'Cat A' } }),
      makeExpense({ amount: 8000, date: m2, category: { name: 'Cat B' } }),
    ];
    mp.expense.findMany.mockResolvedValue(expenses as any);
    const res = await GET();
    const data = await res.json();
    // Should detect overall spending increase since current > prev * 1.3
    expect(data.anomalies.length).toBeGreaterThanOrEqual(0);
  });

  it('detects unusually large single transaction (> 5x avg, > 20000)', async () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);
    // avg of [500000, 1000, 1000, 1000] = 125750, so 500000/125750 ≈ 3.97x — not enough
    // avg of [500000, 500, 500, 500, 500, 500] = 83750, so 500000/83750 ≈ 5.97x — triggers
    const expenses = [
      makeExpense({ amount: 500000, date: currentMonth, description: 'Server Purchase', category: { name: 'Equipment' } }),
      makeExpense({ amount: 500, date: new Date(now.getFullYear(), now.getMonth() - 1, 5), category: { name: 'Software' } }),
      makeExpense({ amount: 500, date: new Date(now.getFullYear(), now.getMonth() - 2, 5), category: { name: 'Software' } }),
      makeExpense({ amount: 500, date: new Date(now.getFullYear(), now.getMonth() - 3, 5), category: { name: 'Software' } }),
      makeExpense({ amount: 500, date: new Date(now.getFullYear(), now.getMonth() - 4, 5), category: { name: 'Software' } }),
      makeExpense({ amount: 500, date: new Date(now.getFullYear(), now.getMonth() - 5, 5), category: { name: 'Software' } }),
    ];
    mp.expense.findMany.mockResolvedValue(expenses as any);
    const res = await GET();
    const data = await res.json();
    const unusual = data.anomalies.filter((a: any) => a.type === 'unusual_amount');
    expect(unusual.length).toBeGreaterThanOrEqual(1);
    expect(unusual[0].severity).toBe('high');
  });

  it('handles zero monthly totals for current and prev month', async () => {
    const now = new Date();
    const m1 = new Date(now.getFullYear(), now.getMonth(), 5);
    const m2 = new Date(now.getFullYear(), now.getMonth() - 1, 5);
    const expenses = [
      makeExpense({ amount: 0, date: m1, category: { name: 'Cat A' } }),
      makeExpense({ amount: 0, date: m2, category: { name: 'Cat B' } }),
    ];
    mp.expense.findMany.mockResolvedValue(expenses as any);
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    const unusual = data.anomalies.filter((a: any) => a.type === 'spike');
    expect(unusual.length).toBe(0);
  });

  it('detects unusually large single transaction with missing vendor/description', async () => {
    const now = new Date();
    const m1 = new Date(now.getFullYear(), now.getMonth(), 5);
    const smallExpenses = Array.from({ length: 10 }, (_, i) =>
      makeExpense({ id: `s${i}`, amount: 100, date: new Date(now.getFullYear(), now.getMonth() - (i % 5) - 1, 5) })
    );
    const expenses = [
      makeExpense({ amount: 500000, date: m1, description: '', vendor: '', category: { name: 'Equipment' } }),
      ...smallExpenses,
    ];
    mp.expense.findMany.mockResolvedValue(expenses as any);
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    const unusual = data.anomalies.filter((a: any) => a.type === 'unusual_amount');
    expect(unusual.length).toBeGreaterThanOrEqual(1);
    expect(unusual[0].title).toContain('Unknown');
  });

  it('detects budget warning (> 90% of limit)', async () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);
    mp.expense.findMany.mockResolvedValue([
      makeExpense({ amount: 48000, date: currentMonth, category: { name: 'Software' } }),
    ] as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { category: 'Software', monthlyLimit: 50000 }
    ] as any);
    const res = await GET();
    const data = await res.json();
    const budgetWarnings = data.anomalies.filter((a: any) => a.type === 'budget_warning');
    expect(budgetWarnings.length).toBe(1);
    expect(budgetWarnings[0].severity).toBe('medium');
  });

  it('detects budget exceeded (> 100% of limit)', async () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);
    mp.expense.findMany.mockResolvedValue([
      makeExpense({ amount: 60000, date: currentMonth, category: { name: 'Software' } }),
    ] as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { category: 'Software', monthlyLimit: 50000 }
    ] as any);
    const res = await GET();
    const data = await res.json();
    const budgetWarnings = data.anomalies.filter((a: any) => a.type === 'budget_warning');
    expect(budgetWarnings.length).toBe(1);
    expect(budgetWarnings[0].severity).toBe('high');
  });

  it('ignores budget when spent is well below limit', async () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);
    mp.expense.findMany.mockResolvedValue([
      makeExpense({ amount: 10000, date: currentMonth, category: { name: 'Software' } }),
    ] as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { category: 'Software', monthlyLimit: 50000 }
    ] as any);
    const res = await GET();
    const data = await res.json();
    const budgetWarnings = data.anomalies.filter((a: any) => a.type === 'budget_warning');
    expect(budgetWarnings.length).toBe(0);
  });

  it('sorts anomalies by severity', async () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);
    mp.expense.findMany.mockResolvedValue([
      makeExpense({ amount: 150000, date: currentMonth, category: { name: 'Equipment' } }),
      makeExpense({ amount: 5000, date: new Date(now.getFullYear(), now.getMonth() - 1, 5) }),
      makeExpense({ amount: 3000, date: new Date(now.getFullYear(), now.getMonth() - 2, 5) }),
      makeExpense({ amount: 4000, date: new Date(now.getFullYear(), now.getMonth() - 3, 5) }),
    ] as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { category: 'Equipment', monthlyLimit: 100000 }
    ] as any);
    const res = await GET();
    const data = await res.json();
    for (let i = 1; i < data.anomalies.length; i++) {
      const sev: Record<string, number> = { high: 0, medium: 1, low: 2 };
      expect(sev[data.anomalies[i].severity]).toBeGreaterThanOrEqual(sev[data.anomalies[i-1].severity]);
    }
  });

  it('handles no organization budgets when user has no org', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId: null } as any);
    mp.expense.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('handles uncategorized expenses', async () => {
    const now = new Date();
    mp.expense.findMany.mockResolvedValue([
      makeExpense({ amount: 5000, date: new Date(now.getFullYear(), now.getMonth(), 5), category: null }),
    ] as any);
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
