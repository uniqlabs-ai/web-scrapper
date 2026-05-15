import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    revenue: { findMany: vi.fn() },
    expense: { findMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/reports/comparison/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('GET /api/reports/comparison', () => {
  function makeReq(period?: string): NextRequest {
    const url = new URL('http://localhost:3008/api/reports/comparison');
    if (period) url.searchParams.set('period', period);
    return new NextRequest(url, { method: 'GET' });
  }

  it('handles month period comparison', async () => {
    mp.revenue.findMany.mockResolvedValueOnce([{ amount: 1000 }] as any) // cur
                     .mockResolvedValueOnce([{ amount: 500 }] as any);  // prev
    mp.expense.findMany.mockResolvedValueOnce([{ amount: 200, category: { name: 'Food' } }] as any) // cur
                     .mockResolvedValueOnce([{ amount: 100, category: { name: 'Food' } }] as any); // prev

    const res = await GET(makeReq('month'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.current.revenue).toBe(1000);
    expect(data.previous.revenue).toBe(500);
    expect(data.changes.revenue).toBe(100);
    
    expect(data.categoryComparison.length).toBe(1);
    expect(data.categoryComparison[0].category).toBe('Food');
    expect(data.categoryComparison[0].current).toBe(200);
    expect(data.categoryComparison[0].previous).toBe(100);
  });

  it('handles quarter period comparison', async () => {
    mp.revenue.findMany.mockResolvedValue([]);
    mp.expense.findMany.mockResolvedValue([]);

    const res = await GET(makeReq('quarter'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.current.revenue).toBe(0);
  });

  it('handles year period comparison', async () => {
    mp.revenue.findMany.mockResolvedValue([]);
    mp.expense.findMany.mockResolvedValue([]);

    const res = await GET(makeReq('year'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.current.revenue).toBe(0);
  });

  it('handles empty previous data gracefully', async () => {
    mp.revenue.findMany.mockResolvedValueOnce([{ amount: 1000 }] as any) // cur
                     .mockResolvedValueOnce([] as any);  // prev
    mp.expense.findMany.mockResolvedValueOnce([{ amount: 200 }] as any) // cur uncategorized
                     .mockResolvedValueOnce([] as any); // prev

    const res = await GET(makeReq('month'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.changes.revenue).toBe(100); // cur > 0, prev = 0 => 100% change
    expect(data.categoryComparison[0].category).toBe('Uncategorized');
  });

  it('handles zero current data gracefully', async () => {
    mp.revenue.findMany.mockResolvedValueOnce([] as any) // cur
                     .mockResolvedValueOnce([{ amount: 100 }] as any);  // prev
    mp.expense.findMany.mockResolvedValue([]); 

    const res = await GET(makeReq('month'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.changes.revenue).toBe(-100); 
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });
});
