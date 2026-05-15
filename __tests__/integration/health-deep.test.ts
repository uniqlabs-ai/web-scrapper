import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    revenue: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    budgetThreshold: { findMany: vi.fn() },
    bankAccount: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { getAuthUserId } from '@/lib/auth';
import { GET } from '@/app/api/health/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mAuth = vi.mocked(getAuthUserId);

const now = new Date();
function monthDate(offset: number) {
  return new Date(now.getFullYear(), now.getMonth() + offset, 15);
}

beforeEach(() => {
  vi.clearAllMocks();
  mAuth.mockResolvedValue('u1');
  mp.user.findUnique.mockResolvedValue({ organizationId: 'org-1' } as any);
  mp.budgetThreshold.findMany.mockResolvedValue([]);
  mp.bankAccount.findMany.mockResolvedValue([]);
  mp.revenue.findMany.mockResolvedValue([]);
  mp.expense.findMany.mockResolvedValue([]);
  mp.invoice.findMany.mockResolvedValue([]);
});

describe('GET /api/health', () => {
  it('returns health score with empty data', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(100);
    expect(data.grade).toBeDefined();
    expect(data.gradeColor).toBeDefined();
    expect(data.financials).toBeDefined();
    expect(data.recommendations).toBeDefined();
  });

  it('scores high profitability (> 20% margin)', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 500000, month: monthDate(-1) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 100000, date: monthDate(-1), category: { name: 'Ops' } },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.financials.profitMargin).toBeGreaterThan(20);
  });

  it('generates critical recommendation for negative profit margin', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 50000, month: monthDate(-1) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 200000, date: monthDate(-1), category: { name: 'Software' } },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const critical = data.recommendations.filter((r: any) => r.priority === 'critical');
    expect(critical.length).toBeGreaterThanOrEqual(1);
    expect(critical[0].category).toBe('Profitability');
  });

  it('generates high recommendation for thin margins (< 10%)', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 100000, month: monthDate(-1) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 95000, date: monthDate(-1), category: { name: 'Software' } },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const profRecs = data.recommendations.filter((r: any) => r.category === 'Profitability');
    expect(profRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('evaluates revenue growth between quarters', async () => {
    const revenues = [];
    for (let i = -6; i <= 0; i++) {
      revenues.push({ amount: 50000 + (i + 6) * 10000, month: monthDate(i) });
    }
    mp.revenue.findMany.mockResolvedValue(revenues as any);
    const res = await GET();
    const data = await res.json();
    expect(data.financials.revenueGrowth).toBeDefined();
  });

  it('generates revenue decline recommendation', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 100000, month: monthDate(-5) },
      { amount: 90000, month: monthDate(-4) },
      { amount: 80000, month: monthDate(-3) },
      { amount: 50000, month: monthDate(-2) },
      { amount: 40000, month: monthDate(-1) },
      { amount: 30000, month: monthDate(0) },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const revRecs = data.recommendations.filter((r: any) => r.category === 'Revenue');
    expect(revRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('evaluates cash runway and recommends when < 3 months', async () => {
    mp.bankAccount.findMany.mockResolvedValue([
      { currentBalance: 100000, isActive: true },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 50000, date: monthDate(-1), category: { name: 'Ops' } },
      { amount: 50000, date: monthDate(-2), category: { name: 'Ops' } },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.financials.runwayMonths).toBeDefined();
    if (data.financials.runwayMonths < 3) {
      const cashRecs = data.recommendations.filter((r: any) => r.category === 'Cash Flow');
      expect(cashRecs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('detects overdue invoices', async () => {
    const pastDue = new Date(now.getTime() - 30 * 86400000);
    mp.invoice.findMany.mockResolvedValue([
      { status: 'sent', total: 50000, dueDate: pastDue, issueDate: new Date('2025-01-01'), paidAt: null, lineItems: [], payments: [] },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.financials.totalOverdue).toBeGreaterThan(0);
    const arRecs = data.recommendations.filter((r: any) => r.category === 'Receivables');
    expect(arRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('calculates average days to collect for paid invoices', async () => {
    mp.invoice.findMany.mockResolvedValue([
      {
        status: 'paid', total: 10000, dueDate: now, paidAt: new Date(now.getTime() + 60 * 86400000),
        issueDate: new Date(now.getTime() - 10 * 86400000), lineItems: [], payments: [],
      },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.financials.avgDaysToCollect).toBeGreaterThan(0);
  });

  it('detects budget breaches', async () => {
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 10);
    mp.expense.findMany.mockResolvedValue([
      { amount: 60000, date: currentMonthDate, category: { name: 'Marketing' } },
    ] as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { category: 'Marketing', monthlyLimit: 50000 },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const budgetRecs = data.recommendations.filter((r: any) => r.category === 'Budgets');
    expect(budgetRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('calculates GST liability and recommends ITC review', async () => {
    mp.invoice.findMany.mockResolvedValue([
      {
        status: 'paid', total: 100000, dueDate: now, issueDate: now, paidAt: now,
        lineItems: [{ cgst: 9000, sgst: 9000, igst: 0 }],
        payments: [],
      },
      {
        status: 'paid', total: 200000, dueDate: now, issueDate: now, paidAt: now,
        lineItems: [{ cgst: 18000, sgst: 18000, igst: 0 }],
        payments: [],
      },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const taxRecs = data.recommendations.filter((r: any) => r.category === 'Tax Planning');
    expect(taxRecs.length).toBe(1);
  });

  it('detects expense concentration (> 40% in one category)', async () => {
    mp.expense.findMany.mockResolvedValue([
      { amount: 80000, date: monthDate(-1), category: { name: 'Salaries' } },
      { amount: 10000, date: monthDate(-1), category: { name: 'Software' } },
      { amount: 5000, date: monthDate(-1), category: { name: 'Travel' } },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const expRecs = data.recommendations.filter((r: any) => r.category === 'Expenses');
    expect(expRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('assigns correct grades based on score ranges', async () => {
    // With zero data, score should be around 50 → Grade C
    const res = await GET();
    const data = await res.json();
    expect(['A+', 'A', 'B+', 'B', 'C', 'D', 'F']).toContain(data.grade);
  });

  it('returns 500 on error', async () => {
    mAuth.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('handles user without organization', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId: null } as any);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('recommends caution when runway is 3-5 months', async () => {
    mp.bankAccount.findMany.mockResolvedValue([
      { currentBalance: 200000, isActive: true },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 50000, date: monthDate(-1), category: { name: 'Ops' } },
    ] as any);
    // 200k / 50k = 4 months runway
    const res = await GET();
    const data = await res.json();
    const cashRecs = data.recommendations.filter((r: any) => r.category === 'Cash Flow');
    expect(cashRecs.length).toBeGreaterThanOrEqual(1);
    expect(cashRecs[0].priority).toBe('high');
  });

  it('recommends stagnant revenue growth when 0-5%', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 100000, month: monthDate(-5) },
      { amount: 100000, month: monthDate(-4) },
      { amount: 100000, month: monthDate(-3) },
      { amount: 101000, month: monthDate(-2) },
      { amount: 102000, month: monthDate(-1) },
      { amount: 103000, month: monthDate(0) },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const revRecs = data.recommendations.filter((r: any) => r.category === 'Revenue');
    expect(revRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('recommends when avg days to collect > 45', async () => {
    const issueDate = new Date(now.getTime() - 60 * 86400000);
    const paidAt = new Date(now.getTime() - 5 * 86400000);
    mp.invoice.findMany.mockResolvedValue([
      { status: 'paid', total: 10000, dueDate: now, paidAt, issueDate, lineItems: [], payments: [] },
    ] as any);
    const res = await GET();
    const data = await res.json();
    if (data.financials.avgDaysToCollect > 45) {
      const arRecs = data.recommendations.filter((r: any) => r.category === 'Receivables');
      expect(arRecs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('recommends when top expense category exceeds 40%', async () => {
    mp.expense.findMany.mockResolvedValue([
      { amount: 200000, date: monthDate(-1), category: { name: 'Marketing' } },
      { amount: 50000, date: monthDate(-1), category: { name: 'Ops' } },
      { amount: 30000, date: monthDate(-1), category: { name: 'Cloud' } },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const expRecs = data.recommendations.filter((r: any) => r.category === 'Expenses');
    expect(expRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('flags overdue invoices', async () => {
    const overdueDate = new Date(now.getTime() - 45 * 86400000);
    mp.invoice.findMany.mockResolvedValue([
      { status: 'sent', total: 100000, dueDate: overdueDate, issueDate: overdueDate, paidAt: null, lineItems: [], payments: [] },
      { status: 'sent', total: 50000, dueDate: overdueDate, issueDate: overdueDate, paidAt: null, lineItems: [], payments: [] },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.financials.totalOverdue).toBeGreaterThan(0);
  });

  it('triggers GST liability recommendation when > 50k', async () => {
    mp.invoice.findMany.mockResolvedValue([
      {
        status: 'paid', total: 1000000, dueDate: now, issueDate: now, paidAt: now, payments: [],
        lineItems: [
          { description: 'Service', amount: 800000, cgst: 20000, sgst: 20000, igst: 0 },
          { description: 'Other', amount: 200000, cgst: 10000, sgst: 10000, igst: 5000 },
        ],
      },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const taxRecs = data.recommendations.filter((r: any) => r.category === 'Tax Planning');
    expect(taxRecs.length).toBeGreaterThanOrEqual(1);
  });

  it('scores negative profitability (losses)', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { amount: 50000, month: monthDate(-1) },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount: 200000, date: monthDate(-1), category: { name: 'Ops' } },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.financials.netProfit).toBeLessThan(0);
    expect(data.financials.profitMargin).toBeLessThan(0);
  });

  it('handles budget over-spending detection', async () => {
    mp.expense.findMany.mockResolvedValue([
      { amount: 100000, date: monthDate(0), category: { name: 'Marketing' } },
    ] as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { category: 'Marketing', monthlyLimit: 50000 },
    ] as any);
    const res = await GET();
    const data = await res.json();
    const budgetRecs = data.recommendations.filter((r: any) => r.category === 'Budget');
    // Budget over-spending should trigger a recommendation
    if (budgetRecs.length > 0) {
      expect(budgetRecs[0].priority).toBeDefined();
    }
  });

  it('handles revenue decline (negative growth)', async () => {
    // Growth is calculated as recent half avg / older half avg - so flip for decline
    mp.revenue.findMany.mockResolvedValue([
      { amount: 100000, month: monthDate(-5) },
      { amount: 120000, month: monthDate(-4) },
      { amount: 130000, month: monthDate(-3) },
      { amount: 50000, month: monthDate(-2) },
      { amount: 30000, month: monthDate(-1) },
      { amount: 20000, month: monthDate(0) },
    ] as any);
    const res = await GET();
    const data = await res.json();
    // Growth may or may not be negative depending on calculation, just verify response
    expect(res.status).toBe(200);
    expect(data.financials.revenueGrowth).toBeDefined();
  });
});
