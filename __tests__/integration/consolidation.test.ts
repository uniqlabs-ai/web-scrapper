import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    revenue: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/currency', () => ({ convertToINR: vi.fn((a:number) => a), convertFromINR: vi.fn((a:number) => a) }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/consolidation/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function req(): NextRequest { return new NextRequest(new URL('http://localhost:3008/api/consolidation'), { method:'GET' }); }

describe('GET /api/consolidation', () => {
  it('returns consolidated view with HQ + subsidiaries', async () => {
    (mp.user.findUnique as any).mockResolvedValue({
      organization: {
        id:'org-1', name:'HQ Corp', currency:'INR', type:'hq',
        subsidiaries: [{ id:'sub-1', name:'US LLC', currency:'USD', type:'subsidiary' }],
      },
    });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { organizationId:'org-1', currentBalance:500000, currency:'INR', isActive:true },
      { organizationId:'sub-1', currentBalance:10000, currency:'USD', isActive:true },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([]);
    (mp.revenue.findMany as any).mockResolvedValue([]);
    (mp.invoice.findMany as any).mockResolvedValue([]);

    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.hq.name).toBe('HQ Corp');
    expect(d.global.totalCash).toBe(510000);
    expect(d.subsidiaries).toHaveLength(2);
  });

  it('returns 400 when user has no organization', async () => {
    (mp.user.findUnique as any).mockResolvedValue({ organization: null });
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it('eliminates inter-company revenue', async () => {
    (mp.user.findUnique as any).mockResolvedValue({
      organization: {
        id:'org-1', name:'HQ Corp', currency:'INR', type:'hq',
        subsidiaries: [{ id:'sub-1', name:'US LLC', currency:'USD', type:'subsidiary' }],
      },
    });
    (mp.bankAccount.findMany as any).mockResolvedValue([]);
    (mp.expense.findMany as any).mockResolvedValue([]);
    (mp.revenue.findMany as any).mockResolvedValue([
      { organizationId:'org-1', amount:100000, currency:'INR', type:'recurring', month:new Date(), client:{ name:'US LLC' } },
      { organizationId:'org-1', amount:200000, currency:'INR', type:'recurring', month:new Date(), client:{ name:'External Client' } },
    ]);
    (mp.invoice.findMany as any).mockResolvedValue([]);

    const res = await GET(req());
    const d = await res.json();
    // Inter-company revenue should be eliminated
    expect(d.global.mrr).toBe(200000);
    expect(d.global.eliminations.mrr).toBe(100000);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
