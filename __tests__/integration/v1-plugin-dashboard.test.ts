import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/runway', () => ({
  getRunway: vi.fn(),
  getBurnRate: vi.fn(),
  getRevenueData: vi.fn(),
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/founder-os-jwt', () => ({ extractFounderOSToken: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { extractFounderOSToken } from '@/lib/founder-os-jwt';
import { getRunway, getBurnRate, getRevenueData } from '@/lib/runway';
import { GET } from '@/app/api/v1/plugin/dashboard/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);
const mj = vi.mocked(extractFounderOSToken);
const mr = vi.mocked(getRunway);
const mb = vi.mocked(getBurnRate);
const mrev = vi.mocked(getRevenueData);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mj.mockReturnValue(null);
  mr.mockResolvedValue({ runwayMonths: 12 } as any);
  mb.mockResolvedValue({ currentMonth: 5000 } as any);
  mrev.mockResolvedValue({ currentMRR: 15000 } as any);
});

describe('GET /api/v1/plugin/dashboard', () => {
  it('returns valid dashboard data using tenant auth', async () => {
    mp.invoice.findMany.mockResolvedValue([
      { id: 'i1', total: 1000, status: 'sent', issueDate: new Date() },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { id: 'e1', amount: 200, createdAt: new Date(), description: 'Test' }
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/v1/plugin/dashboard'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.kpis.monthlyRevenue).toBe('₹15,000');
    expect(data.kpis.burnRate).toBe('₹5,000/mo');
    expect(data.kpis.runwayMonths).toBe(12);
    expect(data.kpis.outstandingInvoices).toBe(1);
    expect(data.recentActivity.length).toBe(1);
    expect(mt).toHaveBeenCalled();
  });

  it('returns valid dashboard data using JWT auth (without orgId in token)', async () => {
    mj.mockReturnValue({ sub: 'u2' } as any); // Has token but no orgId
    
    mp.user.findFirst.mockResolvedValue({ organizationId: 'org-db' } as any);

    mp.invoice.findMany.mockResolvedValue([] as any);
    mp.expense.findMany.mockResolvedValue([] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/v1/plugin/dashboard'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mt).not.toHaveBeenCalled(); // Skipped requireTenant
  });

  it('falls back to empty string if user has no orgId in db', async () => {
    mj.mockReturnValue({ sub: 'u2' } as any); // Has token but no orgId
    
    mp.user.findFirst.mockResolvedValue(null);

    mp.invoice.findMany.mockResolvedValue([] as any);
    mp.expense.findMany.mockResolvedValue([] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/v1/plugin/dashboard'));
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('returns valid dashboard data using JWT auth (with orgId in token)', async () => {
    mj.mockReturnValue({ sub: 'u2', organizationId: 'org-2' } as any); // Has token and orgId
    
    mp.invoice.findMany.mockResolvedValue([] as any);
    mp.expense.findMany.mockResolvedValue([] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/v1/plugin/dashboard'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mt).not.toHaveBeenCalled(); // Skipped requireTenant
  });

  it('returns 200 with error status on unexpected exception', async () => {
    mt.mockRejectedValue(new Error('fail')); // No token, tenant throws
    const req = new NextRequest(new URL('http://localhost:3008/api/v1/plugin/dashboard'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(data.kpis).toEqual({});
  });
});
