import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
    revenue: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    user: { findUnique: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/reports/cfo-brief/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mockFetch.mockReset();
  process.env.RESEND_API_KEY = 'test_key';
});

describe('/api/reports/cfo-brief', () => {
  describe('GET', () => {
    it('returns CFO brief data correctly', async () => {
      const now = new Date();
      mp.expense.findMany.mockResolvedValue([{ amount: 1000, date: now, category: { name: 'Rent' } }] as any);
      mp.revenue.findMany.mockResolvedValue([{ amount: 5000, month: now }] as any);
      mp.invoice.findMany.mockResolvedValue([{ total: 1000, status: 'sent', dueDate: new Date(now.getTime() - 86400000) }] as any);
      mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 10000 }] as any);
      mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test Org' } } as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.companyName).toBe('Test Org');
      expect(data.cashPosition.totalCash).toBe(10000);
      expect(data.receivables.overdue).toBe(1000);
      expect(data.alerts.length).toBeGreaterThan(0);
    });

    it('handles zero expenses and revenues (empty state)', async () => {
      mp.expense.findMany.mockResolvedValue([]);
      mp.revenue.findMany.mockResolvedValue([]);
      mp.invoice.findMany.mockResolvedValue([]);
      mp.bankAccount.findMany.mockResolvedValue([]);
      mp.user.findUnique.mockResolvedValue(null);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.companyName).toBe('Your Company');
      expect(data.cashPosition.runwayMonths).toBe(99);
      expect(data.profitability.profitMargin).toBe(0);
      expect(data.revenue.avgMonthly).toBe(0);
    });

    it('triggers low runway and negative profit margin alerts', async () => {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 3 * 86400000);
      mp.expense.findMany.mockResolvedValue([
        { amount: 50000, date: weekAgo, category: null },
        { amount: 50000, date: weekAgo, category: { name: 'Salaries' } },
      ] as any);
      mp.revenue.findMany.mockResolvedValue([{ amount: 1000, month: now }] as any);
      mp.invoice.findMany.mockResolvedValue([]);
      mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 10000 }] as any);
      mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test' } } as any);

      const res = await GET();
      const data = await res.json();
      expect(data.alerts.some((a: string) => a.includes('runway'))).toBe(true);
      expect(data.alerts.some((a: string) => a.includes('loss'))).toBe(true);
    });

    it('triggers high weekly spend alert', async () => {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 2 * 86400000);
      mp.expense.findMany.mockResolvedValue([
        { amount: 80000, date: weekAgo, category: { name: 'Software' } },
      ] as any);
      mp.revenue.findMany.mockResolvedValue([{ amount: 200000, month: now }] as any);
      mp.invoice.findMany.mockResolvedValue([]);
      mp.bankAccount.findMany.mockResolvedValue([{ currentBalance: 500000 }] as any);
      mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test' } } as any);

      const res = await GET();
      const data = await res.json();
      // weekTotal (80000) > avgMonthlyExpenses * 0.35 should trigger alert
      expect(data.alerts.some((a: string) => a.includes('35%'))).toBe(true);
    });

    it('handles cancelled/paid invoices (excluded from receivables)', async () => {
      const now = new Date();
      mp.expense.findMany.mockResolvedValue([]);
      mp.revenue.findMany.mockResolvedValue([]);
      mp.invoice.findMany.mockResolvedValue([
        { total: 5000, status: 'paid', dueDate: now },
        { total: 3000, status: 'cancelled', dueDate: now },
        { total: 2000, status: 'sent', dueDate: new Date(now.getTime() + 86400000) }, // not overdue
      ] as any);
      mp.bankAccount.findMany.mockResolvedValue([]);
      mp.user.findUnique.mockResolvedValue({ organization: { name: 'Test' } } as any);

      const res = await GET();
      const data = await res.json();
      expect(data.receivables.outstanding).toBe(2000);
      expect(data.receivables.overdue).toBe(0);
    });

    it('returns 500 on unexpected exception', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/reports/cfo-brief'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 if email is missing', async () => {
      const res = await POST(makeReq({}));
      expect(res.status).toBe(400);
    });

    it('returns 503 if RESEND_API_KEY is missing', async () => {
      delete process.env.RESEND_API_KEY;
      const res = await POST(makeReq({ email: 'test@test.com' }));
      expect(res.status).toBe(503);
    });

    it('sends email and returns 200 on success', async () => {
      mp.expense.findMany.mockResolvedValue([]);
      mp.revenue.findMany.mockResolvedValue([]);
      mp.invoice.findMany.mockResolvedValue([]);
      mp.bankAccount.findMany.mockResolvedValue([]);
      mp.user.findUnique.mockResolvedValue(null);
      mockFetch.mockResolvedValueOnce({ ok: true } as any);

      const res = await POST(makeReq({ email: 'test@test.com' }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('returns 502 if Resend API fails', async () => {
      mp.expense.findMany.mockResolvedValue([]);
      mp.revenue.findMany.mockResolvedValue([]);
      mp.invoice.findMany.mockResolvedValue([]);
      mp.bankAccount.findMany.mockResolvedValue([]);
      mp.user.findUnique.mockResolvedValue(null);
      mockFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('Error') } as any);

      const res = await POST(makeReq({ email: 'test@test.com' }));
      expect(res.status).toBe(502);
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await POST(makeReq({ email: 'test@test.com' }));
      expect(res.status).toBe(500);
    });
  });
});
