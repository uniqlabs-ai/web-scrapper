import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    revenue: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/consolidation/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('GET /api/consolidation', () => {
  it('returns 400 if org not found', async () => {
    mp.user.findUnique.mockResolvedValue(null);
    const req = new NextRequest(new URL('http://localhost:3008/api/consolidation'));
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('rolls up consolidation successfully', async () => {
    mp.user.findUnique.mockResolvedValue({
      id: 'u1',
      organization: {
        id: 'org-1',
        name: 'HQ',
        currency: 'INR',
        type: 'hq',
        subsidiaries: [
          { id: 'sub-1', name: 'Sub 1', currency: 'USD', type: 'subsidiary' }
        ]
      }
    } as any);

    mp.bankAccount.findMany.mockResolvedValue([
      { organizationId: 'org-1', currentBalance: 100000, currency: 'INR' },
      { organizationId: 'sub-1', currentBalance: 1000, currency: 'USD' } // ~83000 INR
    ] as any);

    const now = new Date();
    mp.revenue.findMany.mockResolvedValue([
      { organizationId: 'org-1', amount: 50000, currency: 'INR', type: 'recurring', month: now, client: { name: 'Ext Client' } },
      { organizationId: 'sub-1', amount: 1000, currency: 'USD', type: 'recurring', month: now, client: { name: 'HQ' } } // Elimination!
    ] as any);

    mp.expense.findMany.mockResolvedValue([
      { organizationId: 'org-1', amount: 20000, currency: 'INR', date: now, vendorEntity: { name: 'Ext Vendor' } },
      { organizationId: 'sub-1', amount: 500, currency: 'USD', date: now, vendorEntity: { name: 'HQ' } } // Elimination!
    ] as any);

    mp.invoice.findMany.mockResolvedValue([
      { organizationId: 'org-1', total: 5000, currency: 'INR', status: 'sent' }
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/consolidation'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.global.totalCash).toBeGreaterThan(180000); // 100k + ~83k
    expect(data.global.eliminations.mrr).toBeGreaterThan(0); // The 1000 USD from HQ client
    expect(data.global.eliminations.burn).toBeGreaterThan(0); // The 500 USD to HQ vendor
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const req = new NextRequest(new URL('http://localhost:3008/api/consolidation'));
    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  it('returns 400 when user has null organization', async () => {
    mp.user.findUnique.mockResolvedValue({ id: 'u1', organization: null } as any);
    const req = new NextRequest(new URL('http://localhost:3008/api/consolidation'));
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('skips records with null organizationId and filters correctly', async () => {
    const now = new Date();
    const oldDate = new Date(2020, 0, 1);
    mp.user.findUnique.mockResolvedValue({
      id: 'u1',
      organization: {
        id: 'org-1', name: 'HQ', currency: null, type: 'hq',
        subsidiaries: []
      }
    } as any);

    mp.bankAccount.findMany.mockResolvedValue([
      { organizationId: null, currentBalance: 99999, currency: 'INR' }, // skipped
      { organizationId: 'org-1', currentBalance: 5000, currency: 'INR' },
    ] as any);

    mp.revenue.findMany.mockResolvedValue([
      { organizationId: null, amount: 10000, currency: 'INR', type: 'recurring', month: now, client: null }, // skipped
      { organizationId: 'org-1', amount: 10000, currency: 'INR', type: 'one-time', month: now, client: null }, // skipped (not recurring)
      { organizationId: 'org-1', amount: 5000, currency: 'INR', type: 'recurring', month: oldDate, client: null }, // skipped (old)
      { organizationId: 'org-1', amount: 2000, currency: 'INR', type: 'recurring', month: now, client: null }, // included
    ] as any);

    mp.expense.findMany.mockResolvedValue([
      { organizationId: null, amount: 1000, currency: 'INR', date: now, vendorEntity: null }, // skipped
      { organizationId: 'org-1', amount: 1000, currency: 'INR', date: oldDate, vendorEntity: null }, // skipped (old)
      { organizationId: 'org-1', amount: 500, currency: 'INR', date: now, vendorEntity: null }, // included
    ] as any);

    mp.invoice.findMany.mockResolvedValue([
      { organizationId: null, total: 1000, currency: 'INR', status: 'sent' }, // skipped
      { organizationId: 'org-1', total: 500, currency: 'INR', status: 'cancelled' }, // skipped
      { organizationId: 'org-1', total: 300, currency: 'INR', status: 'sent' }, // included
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/consolidation'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hq.baseCurrency).toBe('INR'); // fallback from null
    expect(data.global.totalCash).toBe(5000);
    expect(data.global.mrr).toBe(2000);
    expect(data.global.mtdBurn).toBe(500);
    expect(data.global.receivables).toBe(300);
  });
});
