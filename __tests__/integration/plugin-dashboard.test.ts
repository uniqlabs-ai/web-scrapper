import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/founder-os-jwt', () => ({ extractFounderOSToken: vi.fn().mockReturnValue(null) }));
vi.mock('@/lib/runway', () => ({
  getRunway: vi.fn().mockResolvedValue({ runwayMonths: 12 }),
  getBurnRate: vi.fn().mockResolvedValue({ currentMonth: 100000 }),
  getRevenueData: vi.fn().mockResolvedValue({ currentMRR: 200000, currentARR: 2400000 }),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/v1/plugin/dashboard/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function req(): NextRequest { return new NextRequest(new URL('http://localhost:3008/api/v1/plugin/dashboard')); }

describe('GET /api/v1/plugin/dashboard', () => {
  it('returns dashboard KPIs', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([{ id:'inv-1', total: 50000 }]);
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'e1', description:'AWS', amount:15000, createdAt:new Date() },
    ]);
    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.productId).toBe('finance');
    expect(d.status).toBe('healthy');
    expect(d.kpis.runwayMonths).toBe(12);
    expect(d.kpis.outstandingInvoices).toBe(1);
    expect(d.recentActivity.length).toBe(1);
  });

  it('returns empty activity for no expenses', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([]);
    (mp.expense.findMany as any).mockResolvedValue([]);
    const res = await GET(req());
    const d = await res.json();
    expect(d.recentActivity).toHaveLength(0);
  });

  it('returns error state on failure', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    const d = await res.json();
    expect(d.status).toBe('error');
  });
});
