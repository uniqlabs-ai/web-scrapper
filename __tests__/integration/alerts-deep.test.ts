import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    expense: { aggregate: vi.fn() },
    invoice: { findMany: vi.fn() },
    bankTransaction: { count: vi.fn() },
    recurringExpense: { count: vi.fn() },
    budgetThreshold: { findMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/anomalies', () => ({ detectAnomalies: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { detectAnomalies } from '@/lib/anomalies';
import { GET } from '@/app/api/alerts/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);
const ma = vi.mocked(detectAnomalies);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  ma.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/alerts', () => {
  it('returns empty alerts if no issues found', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.alerts.length).toBe(0);
  });

  it('generates low cash runway alert', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 1000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 1000 } } as any); // 1 month runway
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.id === 'low-cash')).toBe(true);
  });

  it('generates overdue invoice alert', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    const past = new Date(); past.setDate(past.getDate() - 40);
    mp.invoice.findMany.mockResolvedValue([{ total: 1000, dueDate: past }] as any);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.id === 'overdue-invoices')).toBe(true);
  });

  it('generates budget overrun alert', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId: 'org-1' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValueOnce({ _sum: { amount: 100 } } as any) // runway
                        .mockResolvedValueOnce({ _sum: { amount: 2000 } } as any); // budget

    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([{ category: 'Marketing', monthlyLimit: 1000 }] as any);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.id === 'budget-Marketing')).toBe(true);
  });

  it('returns 200 with empty array on unexpected error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.alerts.length).toBe(0);
  });

  it('generates cash warning alert', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 4000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 1000 } } as any); // 4 month runway
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.id === 'cash-warning')).toBe(true);
  });

  it('generates overdue invoice alert (danger)', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    const past = new Date(); past.setDate(past.getDate() - 40);
    mp.invoice.findMany.mockResolvedValue([{ total: 1000, dueDate: past }, { total: 2000, dueDate: past }] as any);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    const alert = data.alerts.find((a: any) => a.id === 'overdue-invoices');
    expect(alert).toBeDefined();
    expect(alert.type).toBe('danger');
  });

  it('generates compliance deadline alerts (GST)', async () => {
    vi.setSystemTime(new Date('2024-01-18T00:00:00Z')); // GST is 20th
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.id === 'compliance-deadline')).toBe(true);
  });

  it('generates compliance deadline alerts (TDS)', async () => {
    vi.setSystemTime(new Date('2024-07-28T00:00:00Z')); // TDS is 31st
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.title.includes('Quarterly TDS Return'))).toBe(true);
  });

  it('generates compliance deadline alerts (Advance Tax)', async () => {
    vi.setSystemTime(new Date('2024-03-12T00:00:00Z')); // Advance tax Q4 is Mar 15
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.title.includes('Advance Tax'))).toBe(true);
  });

  it('generates unreconciled alert', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(15);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.id === 'unreconciled')).toBe(true);
  });

  it('generates recurring due alert', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(5);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.id === 'recurring-due')).toBe(true);
  });

  it('generates compliance deadline alerts (TDS April - true branch)', async () => {
    vi.setSystemTime(new Date('2024-04-29T00:00:00Z')); // TDS is 30th (1 day left)
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.alerts.some((a: any) => a.title.includes('Quarterly TDS Return'))).toBe(true);
  });

  it('generates multiple compliance deadline alerts', async () => {
    vi.setSystemTime(new Date('2024-07-16T00:00:00Z')); // GST is 20th, TDS is 31st
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 100000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 100 } } as any);
    mp.invoice.findMany.mockResolvedValue([]);
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    const alert = data.alerts.find((a: any) => a.id === 'compliance-deadline');
    expect(alert).toBeDefined();
    expect(alert.message).toContain('more deadlines');
  });

  it('handles 0 monthly burn and null budget amount', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' }, organizationId: 'org1' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 1000 }] as any);
    mp.expense.aggregate.mockResolvedValue({ _sum: { amount: null } } as any); // monthly burn 0
    const past = new Date(); past.setDate(past.getDate() - 10);
    mp.invoice.findMany.mockResolvedValue([{ total: 1000, dueDate: past }] as any); // maxDaysPast <= 30
    mp.bankTransaction.count.mockResolvedValue(0);
    mp.recurringExpense.count.mockResolvedValue(0);
    mp.budgetThreshold.findMany.mockResolvedValue([{ category: 'Marketing', monthlyLimit: 1000 }] as any);

    const res = await GET();
    const data = await res.json();
    
    // Check invoice warning (not danger)
    const invAlert = data.alerts.find((a: any) => a.id === 'overdue-invoices');
    expect(invAlert.type).toBe('warning');

    // Budget not exceeded because it's null
    const budgetAlert = data.alerts.find((a: any) => a.id === 'budget-Marketing');
    expect(budgetAlert).toBeUndefined();
  });
});
