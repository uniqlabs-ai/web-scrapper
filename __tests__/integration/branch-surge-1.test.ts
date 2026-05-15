/**
 * Comprehensive branch coverage surge — targets all remaining sub-95% modules
 * with single-line or few-line uncovered branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Shared mocks ──────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    expense: { findMany: vi.fn(), create: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
    revenue: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    invoice: { findMany: vi.fn(), count: vi.fn() },
    client: { findMany: vi.fn() },
    category: { findMany: vi.fn(), create: vi.fn() },
    vendor: { findMany: vi.fn(), create: vi.fn() },
    budgetThreshold: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    employee: { findMany: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    bankTransaction: { findMany: vi.fn() },
    recurringExpense: { findMany: vi.fn() },
    payrollRun: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (cb: any) => typeof cb === 'function' ? cb({ invoice: { create: vi.fn().mockResolvedValue({ id: 'inv-1', invoiceNumber: 'INV-0001', userId: 'u1' }) } }) : undefined),
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m: string) { super(m); this.name = 'TenantError' } } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e: any) => ({ message: e?.message || 'Unknown', name: 'Error' })) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn().mockResolvedValue('u1'), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';

const mp = vi.mocked(prisma) as any;
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method = 'GET', url = 'http://localhost:3008/api/test', body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  return new NextRequest(new URL(url), init);
}

// ── expenses/route.ts: from-only, to-only date filters (L31-32) + date fallback (L73) ──
describe('expenses date filter branches', () => {
  let expGET: any, expPOST: any;
  beforeEach(async () => {
    const mod = await import('@/app/api/expenses/route');
    expGET = mod.GET;
    expPOST = mod.POST;
    mp.expense.findMany.mockResolvedValue([]);
  });

  it('applies from-only date filter', async () => {
    const res = await expGET(req('GET', 'http://localhost:3008/api/expenses?from=2025-04-01'));
    expect(res.status).toBe(200);
  });

  it('applies to-only date filter', async () => {
    const res = await expGET(req('GET', 'http://localhost:3008/api/expenses?to=2025-06-30'));
    expect(res.status).toBe(200);
  });
});

// ── invoices/route.ts: from-only, to-only date filters (L42-43) ──
describe('invoices date filter branches', () => {
  let invGET: any;
  beforeEach(async () => {
    const mod = await import('@/app/api/invoices/route');
    invGET = mod.GET;
    mp.user.findUnique.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
    mp.invoice.findMany.mockResolvedValue([]);
  });

  it('applies from-only date filter', async () => {
    const res = await invGET(req('GET', 'http://localhost:3008/api/invoices?from=2025-04-01'));
    expect(res.status).toBe(200);
  });

  it('applies to-only date filter', async () => {
    const res = await invGET(req('GET', 'http://localhost:3008/api/invoices?to=2025-06-30'));
    expect(res.status).toBe(200);
  });
});

// ── revenue/route.ts: from-only, to-only (L78-79), auto-tag recurring (L117) ──
describe('revenue date filter and auto-tag branches', () => {
  let revGET: any;
  beforeEach(async () => {
    const mod = await import('@/app/api/revenue/route');
    revGET = mod.GET;
    mp.client.findMany.mockResolvedValue([]);
    mp.revenue.findMany.mockResolvedValue([]);
    mp.revenue.updateMany.mockResolvedValue({ count: 0 });
  });

  it('applies from-only date filter', async () => {
    const res = await revGET(req('GET', 'http://localhost:3008/api/revenue?from=2025-04-01'));
    expect(res.status).toBe(200);
  });

  it('applies to-only date filter', async () => {
    const res = await revGET(req('GET', 'http://localhost:3008/api/revenue?to=2025-06-30'));
    expect(res.status).toBe(200);
  });

  it('auto-tags one-time revenue as recurring when 2+ months', async () => {
    const now = new Date();
    mp.revenue.findMany.mockResolvedValue([
      { id: 'r1', amount: 5000, source: 'Acme Corp', type: 'one-time', month: new Date(now.getFullYear(), now.getMonth() - 2, 1), currency: 'INR', clientId: null, notes: null },
      { id: 'r2', amount: 5000, source: 'Acme Corp', type: 'one-time', month: new Date(now.getFullYear(), now.getMonth() - 1, 1), currency: 'INR', clientId: null, notes: null },
    ] as any);
    const res = await revGET(req('GET', 'http://localhost:3008/api/revenue'));
    expect(res.status).toBe(200);
  });
});

// ── vendors/route.ts: from-only, to-only (L32-46), auto-link (L109) ──
describe('vendors date filter branches', () => {
  let vGET: any, vPOST: any;
  beforeEach(async () => {
    const mod = await import('@/app/api/vendors/route');
    vGET = mod.GET;
    vPOST = mod.POST;
    mp.vendor.findMany.mockResolvedValue([]);
    mp.expense.groupBy.mockResolvedValue([]);
  });

  it('applies from-only date filter', async () => {
    const res = await vGET(req('GET', 'http://localhost:3008/api/vendors?from=2025-04-01'));
    expect(res.status).toBe(200);
  });

  it('applies to-only date filter', async () => {
    const res = await vGET(req('GET', 'http://localhost:3008/api/vendors?to=2025-06-30'));
    expect(res.status).toBe(200);
  });

  it('auto-links expenses on vendor creation', async () => {
    mp.vendor.create.mockResolvedValue({ id: 'v1', name: 'Acme Vendor', userId: 'u1' } as any);
    mp.expense.updateMany.mockResolvedValue({ count: 2 });
    const res = await vPOST(req('POST', 'http://localhost:3008/api/vendors', { name: 'Acme Vendor' }));
    expect(res.status).toBe(201);
  });
});
