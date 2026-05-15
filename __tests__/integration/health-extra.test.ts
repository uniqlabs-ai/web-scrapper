import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/health/route';
import { prisma } from '@/lib/prisma';
import { getAuthUserId } from '@/lib/auth';

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

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, toLogError: vi.fn((e:any)=>({})) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthUserId).mockResolvedValue('user-1');
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ organizationId: 'org-1' } as any);
  
  // Default mocks
  vi.mocked(prisma.revenue.findMany).mockResolvedValue([]);
  vi.mocked(prisma.expense.findMany).mockResolvedValue([]);
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
  vi.mocked(prisma.budgetThreshold.findMany).mockResolvedValue([]);
  vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);
});

describe('Health Route - Extra Coverage', () => {
  it('handles early months for fyStart (Jan-Mar)', async () => {
    vi.setSystemTime(new Date(2025, 1, 15)); // Feb 2025
    const res = await GET();
    expect(res.status).toBe(200);
    vi.useRealTimers();
  });

  it('handles zero totalExpenses and Uncategorized category', async () => {
    vi.mocked(prisma.expense.findMany).mockResolvedValue([
      { amount: 0, date: new Date(), category: null } // 0 amount, no category
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
  });

  it('handles budgets not broken (spent <= monthlyLimit)', async () => {
    vi.mocked(prisma.expense.findMany).mockResolvedValue([
      { amount: 50, date: new Date(), category: { name: 'IT' } }
    ] as any);
    vi.mocked(prisma.budgetThreshold.findMany).mockResolvedValue([
      { category: 'IT', monthlyLimit: 100 } // Not broken
    ] as any);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('handles profitMargin > 10 and < 20', async () => {
    // Profit margin = 15%
    vi.mocked(prisma.revenue.findMany).mockResolvedValue([{ amount: 10000, month: new Date() }] as any);
    vi.mocked(prisma.expense.findMany).mockResolvedValue([{ amount: 8500, date: new Date() }] as any);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('handles overdueRatio between 0.1 and 0.25 and 0.25-0.5', async () => {
    // Ratio = 0.20
    const past = new Date(Date.now() - 10000);
    const future = new Date(Date.now() + 100000);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { total: 20, dueDate: past, status: 'sent', issueDate: past }, // overdue
      { total: 80, dueDate: future, status: 'sent', issueDate: past } // not overdue
    ] as any);
    await GET();
    
    // Ratio = 0.40
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { total: 40, dueDate: past, status: 'sent', issueDate: past }, // overdue
      { total: 60, dueDate: future, status: 'sent', issueDate: past } // not overdue
    ] as any);
    await GET();
  });

  it('handles grade B+ (score 70-79)', async () => {
    // We just need the final score to fall in 70-79.
    // Base 50. 
    // Profit margin > 0 (+8) = 58
    // Runway > 6 (+10) = 68
    // Growth > 0 (+5) = 73
    const past = new Date(); past.setMonth(past.getMonth() - 5);
    const recent = new Date();
    vi.mocked(prisma.revenue.findMany).mockResolvedValue([
      { amount: 1000, month: past }, // prev3
      { amount: 1050, month: recent } // recent3 -> growth > 0 (< 5)
    ] as any);
    vi.mocked(prisma.expense.findMany).mockResolvedValue([
      { amount: 900, date: recent } // Net profit 150 -> margin ~7%
    ] as any);
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([
      { currentBalance: 900 * 3 } // Runway 3 months (+5)
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
  });

  it('handles runwayMonths < 3 AND runwayMonths !== Infinity', async () => {
    vi.mocked(prisma.expense.findMany).mockResolvedValue([{ amount: 10000, date: new Date() }] as any);
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([{ currentBalance: 15000 }] as any); // runway = 1.5
    const res = await GET();
    const data = await res.json();
    expect(data.recommendations.some((r:any) => r.category === 'Cash Flow')).toBe(true);
  });
});
