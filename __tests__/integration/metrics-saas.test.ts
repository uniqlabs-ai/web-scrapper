import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    revenue: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    client: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/metrics/saas/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  (mp.revenue.findMany as any).mockResolvedValue([]);
  (mp.expense.findMany as any).mockResolvedValue([]);
  (mp.client.findMany as any).mockResolvedValue([]);
  (mp.client.count as any).mockResolvedValue(10);
});

function req(): NextRequest { return new NextRequest(new URL('http://localhost:3008/api/metrics/saas'), { method:'GET' }); }

describe('GET /api/metrics/saas', () => {
  it('returns SaaS metrics with MRR, ARR, CAC, LTV', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount:100000, month:thisMonth },
    ]);
    (mp.client.count as any).mockResolvedValue(5);

    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.metrics.mrr).toBe(100000);
    expect(d.metrics.arr).toBe(1200000);
    expect(d.metrics.activeClients).toBe(5);
    expect(d.trends).toBeDefined();
    expect(d.trends.length).toBe(12);
  });

  it('calculates MRR growth', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount:120000, month:thisMonth },
      { amount:100000, month:lastMonth },
    ]);
    const res = await GET(req());
    const d = await res.json();
    expect(d.metrics.mrrGrowth).toBe(20);
    expect(d.alerts.some((a: string) => a.includes('MRR grew'))).toBe(true);
  });

  it('generates LTV:CAC warning when ratio < 1', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount:10000, month:thisMonth },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([
      { amount:500000, date:thisMonth, category:{ name:'Marketing' } },
    ]);
    (mp.client.findMany as any).mockResolvedValue([
      { createdAt:thisMonth },
    ]);
    (mp.client.count as any).mockResolvedValue(1);
    const res = await GET(req());
    const d = await res.json();
    expect(d.metrics.cac).toBe(500000);
    expect(d.alerts.some((a: string) => a.includes('WARNING'))).toBe(true);
  });

  it('handles empty data', async () => {
    const res = await GET(req());
    const d = await res.json();
    expect(d.metrics.mrr).toBe(0);
    expect(d.metrics.arr).toBe(0);
    expect(d.trends).toHaveLength(12);
  });

  it('generates healthy growth alert when LTV:CAC >= 3', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // High ARPU: 100k MRR / 1 client = 100k ARPU → LTV = 100k / 0.03 = 3,333,333
    // Low CAC: 10k spend / 1 new client = 10k CAC → LTV:CAC = 333x
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount: 100000, month: thisMonth },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 10000, date: thisMonth, category: { name: 'Marketing' } },
    ]);
    (mp.client.findMany as any).mockResolvedValue([
      { createdAt: thisMonth },
    ]);
    (mp.client.count as any).mockResolvedValue(1);
    const res = await GET(req());
    const d = await res.json();
    expect(d.metrics.ltvCacRatio).toBeGreaterThanOrEqual(3);
    expect(d.alerts.some((a: string) => a.includes('Healthy Growth'))).toBe(true);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
