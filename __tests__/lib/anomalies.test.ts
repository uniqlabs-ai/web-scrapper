import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing
vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { detectAnomalies, type AnomalyAlert } from '@/lib/anomalies';

import { mockPrisma } from '../helpers/prisma-mock';
const mockedPrisma = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectAnomalies', () => {
  const userId = 'user-123';

  describe('duplicate expense detection', () => {
    it('detects duplicate expenses (same vendor, amount, date)', async () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 5 * 86400000); // 5 days ago

      const duplicateExpenses = [
        { id: '1', amount: 15000, date: recentDate, vendor: 'AWS', vendorEntity: { name: 'AWS' }, category: { name: 'Infrastructure' } },
        { id: '2', amount: 15000, date: recentDate, vendor: 'AWS', vendorEntity: { name: 'AWS' }, category: { name: 'Infrastructure' } },
      ];

      // First findMany for recent expenses, second for historical
      mockedPrisma.expense.findMany
        .mockResolvedValueOnce(duplicateExpenses as any) // recent (last 30 days)
        .mockResolvedValueOnce([] as any); // historical (3 months)

      const alerts = await detectAnomalies(userId);

      const dupeAlert = alerts.find((a) => a.id === 'ai-duplicate-expenses');
      expect(dupeAlert).toBeDefined();
      expect(dupeAlert!.type).toBe('warning');
      expect(dupeAlert!.title).toBe('Duplicate Expenses Detected');
      expect(dupeAlert!.message).toContain('1'); // 1 duplicate
      expect(dupeAlert!.actionUrl).toBe('/expenses?filter=duplicates');
    });

    it('ignores small expenses under ₹100 for duplicate detection', async () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 5 * 86400000);

      const smallDuplicates = [
        { id: '1', amount: 50, date: recentDate, vendor: 'Chai', vendorEntity: null, category: null },
        { id: '2', amount: 50, date: recentDate, vendor: 'Chai', vendorEntity: null, category: null },
      ];

      mockedPrisma.expense.findMany
        .mockResolvedValueOnce(smallDuplicates as any)
        .mockResolvedValueOnce([] as any);

      const alerts = await detectAnomalies(userId);
      const dupeAlert = alerts.find((a) => a.id === 'ai-duplicate-expenses');
      expect(dupeAlert).toBeUndefined(); // ignored because amount < 100
    });

    it('does not flag unique expenses as duplicates', async () => {
      const now = new Date();
      const expenses = [
        { id: '1', amount: 15000, date: new Date(now.getTime() - 1 * 86400000), vendor: 'AWS', vendorEntity: { name: 'AWS' }, category: { name: 'Infrastructure' } },
        { id: '2', amount: 25000, date: new Date(now.getTime() - 2 * 86400000), vendor: 'GCP', vendorEntity: { name: 'GCP' }, category: { name: 'Infrastructure' } },
      ];

      mockedPrisma.expense.findMany
        .mockResolvedValueOnce(expenses as any)
        .mockResolvedValueOnce([] as any);

      const alerts = await detectAnomalies(userId);
      const dupeAlert = alerts.find((a) => a.id === 'ai-duplicate-expenses');
      expect(dupeAlert).toBeUndefined();
    });
  });

  describe('category spend spike detection', () => {
    it('detects >40% spike in category spending', async () => {
      const now = new Date();
      const currentDate = new Date(now.getFullYear(), now.getMonth(), 15);
      const pastDate1 = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const pastDate2 = new Date(now.getFullYear(), now.getMonth() - 2, 15);

      // Current month expenses (high)
      const recentExpenses = [
        { id: '1', amount: 30000, date: currentDate, vendor: null, vendorEntity: null, category: { name: 'Software' } },
      ];

      // Historical expenses (lower average)
      const historicalExpenses = [
        { id: '2', amount: 10000, date: pastDate1, vendor: null, vendorEntity: null, category: { name: 'Software' } },
        { id: '3', amount: 10000, date: pastDate2, vendor: null, vendorEntity: null, category: { name: 'Software' } },
      ];

      mockedPrisma.expense.findMany
        .mockResolvedValueOnce(recentExpenses as any) // recent
        .mockResolvedValueOnce(historicalExpenses as any); // historical

      const alerts = await detectAnomalies(userId);
      const spikeAlert = alerts.find((a) => a.id === 'ai-spike-Software');
      expect(spikeAlert).toBeDefined();
      expect(spikeAlert!.type).toBe('danger');
      expect(spikeAlert!.title).toContain('Spend Spike');
      expect(spikeAlert!.message).toContain('%');
    });

    it('does not flag categories with average below ₹5000', async () => {
      const now = new Date();
      const currentDate = new Date(now.getFullYear(), now.getMonth(), 15);
      const pastDate1 = new Date(now.getFullYear(), now.getMonth() - 1, 15);

      const recentExpenses = [
        { id: '1', amount: 8000, date: currentDate, vendor: null, vendorEntity: null, category: { name: 'Stationery' } },
      ];

      const historicalExpenses = [
        { id: '2', amount: 3000, date: pastDate1, vendor: null, vendorEntity: null, category: { name: 'Stationery' } },
      ];

      mockedPrisma.expense.findMany
        .mockResolvedValueOnce(recentExpenses as any)
        .mockResolvedValueOnce(historicalExpenses as any);

      const alerts = await detectAnomalies(userId);
      const spikeAlert = alerts.find((a) => a.id?.includes('spike'));
      expect(spikeAlert).toBeUndefined(); // avg 3000 < 5000 threshold
    });

    it('does not flag categories within 40% variance', async () => {
      const now = new Date();
      const currentDate = new Date(now.getFullYear(), now.getMonth(), 15);
      const pastDate1 = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const pastDate2 = new Date(now.getFullYear(), now.getMonth() - 2, 15);

      const recentExpenses = [
        { id: '1', amount: 12000, date: currentDate, vendor: null, vendorEntity: null, category: { name: 'Software' } },
      ];

      const historicalExpenses = [
        { id: '2', amount: 10000, date: pastDate1, vendor: null, vendorEntity: null, category: { name: 'Software' } },
        { id: '3', amount: 10000, date: pastDate2, vendor: null, vendorEntity: null, category: { name: 'Software' } },
      ];

      mockedPrisma.expense.findMany
        .mockResolvedValueOnce(recentExpenses as any)
        .mockResolvedValueOnce(historicalExpenses as any);

      const alerts = await detectAnomalies(userId);
      const spikeAlert = alerts.find((a) => a.id?.includes('spike'));
      expect(spikeAlert).toBeUndefined(); // 12000 vs avg 10000 = 20% < 40%
    });
  });

  describe('empty data', () => {
    it('returns empty alerts when no expenses exist', async () => {
      mockedPrisma.expense.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const alerts = await detectAnomalies(userId);
      expect(alerts).toEqual([]);
    });
  });

  describe('alert structure', () => {
    it('every alert has required fields', async () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 5 * 86400000);

      const duplicates = [
        { id: '1', amount: 50000, date: recentDate, vendor: null, vendorEntity: { name: 'Test' }, category: null },
        { id: '2', amount: 50000, date: recentDate, vendor: null, vendorEntity: { name: 'Test' }, category: null },
      ];

      mockedPrisma.expense.findMany
        .mockResolvedValueOnce(duplicates as any)
        .mockResolvedValueOnce([]);

      const alerts = await detectAnomalies(userId);

      for (const alert of alerts) {
        expect(alert.id).toBeTruthy();
        expect(['warning', 'danger', 'info']).toContain(alert.type);
        expect(alert.title).toBeTruthy();
        expect(alert.message).toBeTruthy();
        expect(alert.action).toBeTruthy();
        expect(alert.actionUrl).toBeTruthy();
      }
    });
  });
});
