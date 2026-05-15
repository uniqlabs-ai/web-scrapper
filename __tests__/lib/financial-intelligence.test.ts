import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing
vi.mock('@/lib/prisma', () => ({
  prisma: {
    revenue: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    organization: { findFirst: vi.fn(), findUnique: vi.fn() },
    recurringExpense: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  generatePnL,
  projectCashFlow,
  projectCashFlowOutlook,
  calculateGSTSummary,
} from '@/lib/financial-intelligence';

import { mockPrisma } from '../helpers/prisma-mock';
const mockedPrisma = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── generatePnL ──────────────────────────────────────────────────────

describe('generatePnL', () => {
  const userId = 'user-123';
  const orgId = 'org-123';
  const from = new Date('2025-04-01');
  const to = new Date('2026-03-31');

  it('generates P&L report with revenue and expense lines', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([
      { amount: 500000, type: 'recurring', client: null },
      { amount: 100000, type: 'one-time', client: null },
    ] as any);

    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 85000, category: { name: 'Salaries' }, department: null },
      { amount: 15000, category: { name: 'Software' }, department: null },
    ] as any);

    const report = await generatePnL(userId, orgId, from, to);

    expect(report.totalRevenue).toBe(600000);
    expect(report.totalExpenses).toBe(100000);
    expect(report.grossProfit).toBe(500000);
    expect(report.netIncome).toBe(500000);
    expect(report.profitMargin).toBeCloseTo(83.33, 1);
    expect(report.period.from).toBe(from.toISOString());
    expect(report.period.to).toBe(to.toISOString());
  });

  it('groups revenue by type (Recurring vs One-time)', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([
      { amount: 300000, type: 'recurring', client: null },
      { amount: 200000, type: 'recurring', client: null },
      { amount: 50000, type: 'one-time', client: null },
    ] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([] as any);

    const report = await generatePnL(userId, orgId, from, to);

    expect(report.revenue).toHaveLength(2);
    const recurringLine = report.revenue.find((l) => l.label === 'Recurring Revenue');
    expect(recurringLine!.amount).toBe(500000);
    const oneTimeLine = report.revenue.find((l) => l.label === 'One-time Revenue');
    expect(oneTimeLine!.amount).toBe(50000);
  });

  it('groups expenses by category', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 50000, category: { name: 'Salaries' }, department: null },
      { amount: 30000, category: { name: 'Salaries' }, department: null },
      { amount: 15000, category: { name: 'Software' }, department: null },
    ] as any);

    const report = await generatePnL(userId, orgId, from, to);

    const salaryLine = report.expenses.find((l) => l.label === 'Salaries');
    expect(salaryLine!.amount).toBe(80000);
    const softwareLine = report.expenses.find((l) => l.label === 'Software');
    expect(softwareLine!.amount).toBe(15000);
  });

  it('sorts expense lines by amount descending', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 5000, category: { name: 'Travel' }, department: null },
      { amount: 50000, category: { name: 'Salaries' }, department: null },
      { amount: 15000, category: { name: 'Software' }, department: null },
    ] as any);

    const report = await generatePnL(userId, orgId, from, to);

    expect(report.expenses[0].label).toBe('Salaries');
    expect(report.expenses[1].label).toBe('Software');
    expect(report.expenses[2].label).toBe('Travel');
  });

  it('uses department as fallback when category is null', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 10000, category: null, department: 'Engineering' },
    ] as any);

    const report = await generatePnL(userId, orgId, from, to);
    expect(report.expenses[0].label).toBe('Engineering');
  });

  it('defaults to "Uncategorized" when both category and department are null', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 10000, category: null, department: null },
    ] as any);

    const report = await generatePnL(userId, orgId, from, to);
    expect(report.expenses[0].label).toBe('Uncategorized');
  });

  it('returns 0 profit margin when no revenue', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 10000, category: { name: 'Misc' }, department: null },
    ] as any);

    const report = await generatePnL(userId, orgId, from, to);
    expect(report.profitMargin).toBe(0);
    expect(report.netIncome).toBe(-10000);
  });

  it('handles empty data', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);

    const report = await generatePnL(userId, orgId, from, to);
    expect(report.totalRevenue).toBe(0);
    expect(report.totalExpenses).toBe(0);
    expect(report.grossProfit).toBe(0);
    expect(report.revenue).toEqual([]);
    expect(report.expenses).toEqual([]);
  });
});

// ── projectCashFlow ──────────────────────────────────────────────────

describe('projectCashFlow', () => {
  const userId = 'user-123';
  const orgId = 'org-123';

  it('projects cash flow for 6 months', async () => {
    const now = new Date();
    const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const m2 = new Date(now.getFullYear(), now.getMonth() - 2, 15);

    mockedPrisma.revenue.findMany.mockResolvedValue([
      { month: m1, amount: 100000 },
      { month: m2, amount: 80000 },
    ] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { date: m1, amount: 60000 },
      { date: m2, amount: 50000 },
    ] as any);
    mockedPrisma.organization.findUnique.mockResolvedValue({
      cashInBank: 500000,
    } as any);

    const result = await projectCashFlow(userId, orgId);

    expect(result.projections).toHaveLength(6);
    expect(result.currentBalance).toBe(500000);
    expect(result.projectedRunway).toBeGreaterThan(0);

    // Each projection should have required fields
    for (const p of result.projections) {
      expect(p.month).toBeTruthy();
      expect(typeof p.inflow).toBe('number');
      expect(typeof p.outflow).toBe('number');
      expect(typeof p.net).toBe('number');
      expect(typeof p.balance).toBe('number');
    }
  });

  it('projects correct number of months when specified', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.organization.findUnique.mockResolvedValue({ cashInBank: 100000 } as any);

    const result = await projectCashFlow(userId, orgId, 12);
    expect(result.projections).toHaveLength(12);
  });

  it('handles zero balance gracefully', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.organization.findUnique.mockResolvedValue({ cashInBank: 0 } as any);

    const result = await projectCashFlow(userId, orgId);
    expect(result.currentBalance).toBe(0);
  });

  it('handles null organization gracefully', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.organization.findUnique.mockResolvedValue(null);

    const result = await projectCashFlow(userId, orgId);
    expect(result.currentBalance).toBe(0);
  });

  it('balances never go below 0', async () => {
    const now = new Date();
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { date: new Date(now.getFullYear(), now.getMonth() - 1, 15), amount: 500000 },
    ] as any);
    mockedPrisma.organization.findUnique.mockResolvedValue({ cashInBank: 100000 } as any);

    const result = await projectCashFlow(userId, orgId);
    for (const p of result.projections) {
      expect(p.balance).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── projectCashFlowOutlook ───────────────────────────────────────────

describe('projectCashFlowOutlook', () => {
  const userId = 'user-123';
  const orgId = 'org-123';

  it('returns 30, 60, 90-day snapshots', async () => {
    const now = new Date();
    const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    mockedPrisma.revenue.findMany.mockResolvedValue([
      { month: m1, amount: 200000 },
    ] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { date: m1, amount: 150000 },
    ] as any);
    mockedPrisma.organization.findUnique.mockResolvedValue({ cashInBank: 500000 } as any);
    mockedPrisma.invoice.findMany.mockResolvedValue([
      { total: 100000, dueDate: new Date(Date.now() + 15 * 86400000) },
    ] as any);
    mockedPrisma.recurringExpense.findMany.mockResolvedValue([
      { amount: 10000, frequency: 'monthly' },
    ] as any);

    const result = await projectCashFlowOutlook(userId, orgId);

    expect(result.snapshots).toHaveLength(3);
    expect(result.snapshots[0].label).toBe('30-Day');
    expect(result.snapshots[1].label).toBe('60-Day');
    expect(result.snapshots[2].label).toBe('90-Day');
    expect(result.currentBalance).toBe(500000);
    expect(typeof result.avgMonthlyBurn).toBe('number');
  });

  it('assigns risk levels correctly', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.organization.findUnique.mockResolvedValue({ cashInBank: 1000000 } as any);
    mockedPrisma.invoice.findMany.mockResolvedValue([]);
    mockedPrisma.recurringExpense.findMany.mockResolvedValue([]);

    const result = await projectCashFlowOutlook(userId, orgId);

    for (const snapshot of result.snapshots) {
      expect(['green', 'amber', 'red']).toContain(snapshot.risk);
    }
  });

  it('factors in recurring expenses by frequency', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.organization.findUnique.mockResolvedValue({ cashInBank: 500000 } as any);
    mockedPrisma.invoice.findMany.mockResolvedValue([]);
    mockedPrisma.recurringExpense.findMany.mockResolvedValue([
      { amount: 1000, frequency: 'weekly' },
      { amount: 10000, frequency: 'monthly' },
      { amount: 30000, frequency: 'quarterly' },
      { amount: 120000, frequency: 'yearly' },
    ] as any);

    const result = await projectCashFlowOutlook(userId, orgId);

    // Should complete without error and include outflow data
    for (const snapshot of result.snapshots) {
      expect(snapshot.expectedOutflows).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles null cashInBank gracefully', async () => {
    mockedPrisma.revenue.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.organization.findUnique.mockResolvedValue({ cashInBank: null } as any);
    mockedPrisma.invoice.findMany.mockResolvedValue([]);
    mockedPrisma.recurringExpense.findMany.mockResolvedValue([]);

    const result = await projectCashFlowOutlook(userId, orgId);
    expect(result.currentBalance).toBe(0);
  });
});

// ── calculateGSTSummary ──────────────────────────────────────────────

describe('calculateGSTSummary', () => {
  const userId = 'user-123';
  const orgId = 'org-123';
  const from = new Date('2025-04-01');
  const to = new Date('2025-06-30');

  it('calculates output tax from invoice line items', async () => {
    mockedPrisma.invoice.findMany.mockResolvedValue([
      {
        lineItems: [
          { cgst: 900, sgst: 900, igst: 0 },
          { cgst: 450, sgst: 450, igst: 0 },
        ],
      },
    ] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([]);

    const summary = await calculateGSTSummary(userId, orgId, from, to);

    expect(summary.outputTax.cgst).toBe(1350);
    expect(summary.outputTax.sgst).toBe(1350);
    expect(summary.outputTax.igst).toBe(0);
    expect(summary.outputTax.total).toBe(2700);
    expect(summary.invoiceCount).toBe(1);
  });

  it('calculates IGST for inter-state invoices', async () => {
    mockedPrisma.invoice.findMany.mockResolvedValue([
      {
        lineItems: [
          { cgst: 0, sgst: 0, igst: 1800 },
        ],
      },
    ] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([]);

    const summary = await calculateGSTSummary(userId, orgId, from, to);

    expect(summary.outputTax.igst).toBe(1800);
    expect(summary.outputTax.cgst).toBe(0);
    expect(summary.outputTax.sgst).toBe(0);
  });

  it('estimates input tax credit from expenses with receipts', async () => {
    mockedPrisma.invoice.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 10000, receipt: 'receipt-url.jpg' },
      { amount: 5000, receipt: 'receipt2.pdf' },
      { amount: 8000, receipt: null }, // No receipt — excluded from ITC
    ] as any);

    const summary = await calculateGSTSummary(userId, orgId, from, to);

    // Only 2 expenses with receipts: (10000 + 5000) * 0.18 = 2700
    expect(summary.inputTax).toBe(2700);
    expect(summary.expenseCount).toBe(2); // Only receipted ones
  });

  it('calculates net payable (output - input)', async () => {
    mockedPrisma.invoice.findMany.mockResolvedValue([
      { lineItems: [{ cgst: 1000, sgst: 1000, igst: 0 }] },
    ] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([
      { amount: 5000, receipt: 'receipt.jpg' },
    ] as any);

    const summary = await calculateGSTSummary(userId, orgId, from, to);

    // Output: 2000, Input: 5000 * 0.18 = 900
    expect(summary.netPayable).toBe(1100); // 2000 - 900
  });

  it('returns period info', async () => {
    mockedPrisma.invoice.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);

    const summary = await calculateGSTSummary(userId, orgId, from, to);

    expect(summary.period.from).toBe(from.toISOString());
    expect(summary.period.to).toBe(to.toISOString());
  });

  it('handles empty data', async () => {
    mockedPrisma.invoice.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);

    const summary = await calculateGSTSummary(userId, orgId, from, to);

    expect(summary.outputTax.total).toBe(0);
    expect(summary.inputTax).toBe(0);
    expect(summary.netPayable).toBe(0);
    expect(summary.invoiceCount).toBe(0);
    expect(summary.expenseCount).toBe(0);
  });

  it('rounds all monetary values to 2 decimal places', async () => {
    mockedPrisma.invoice.findMany.mockResolvedValue([
      { lineItems: [{ cgst: 100.556, sgst: 100.554, igst: 0 }] },
    ] as any);
    mockedPrisma.expense.findMany.mockResolvedValue([]);

    const summary = await calculateGSTSummary(userId, orgId, from, to);

    // Check 2-decimal precision
    const cgstStr = summary.outputTax.cgst.toString();
    const decimalPart = cgstStr.split('.')[1];
    if (decimalPart) {
      expect(decimalPart.length).toBeLessThanOrEqual(2);
    }
  });
});
