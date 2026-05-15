import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    revenue: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    client: { findMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST, PATCH } from '@/app/api/revenue/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/revenue', () => {
  describe('GET', () => {
    function makeReq(search?: string): NextRequest {
      return new NextRequest(new URL(`http://localhost:3008/api/revenue${search || ''}`), { method: 'GET' });
    }

    it('handles query with from and to params', async () => {
      mp.revenue.findMany.mockResolvedValue([]);
      mp.client.findMany.mockResolvedValue([]);
      
      const res = await GET(makeReq('?from=2024-01-01&to=2024-12-31'));
      expect(res.status).toBe(200);
      expect(mp.revenue.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          month: { gte: expect.any(Date), lte: expect.any(Date) }
        })
      }));
    });

    it('auto-tags and auto-links correctly', async () => {
      mp.revenue.findMany.mockResolvedValueOnce([
        { id: 'r1', source: 'BILL TO: Acme Corp', month: new Date('2024-01-01'), type: 'one_time' },
        { id: 'r2', source: 'Acme Corp', month: new Date('2024-02-01'), type: 'one_time' },
        { id: 'r3', source: 'GRS/Short', month: new Date('2024-03-01'), type: 'one_time' }
      ] as any).mockResolvedValueOnce([]); // 2nd call after updates

      mp.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme Corp', company: null }] as any);
      mp.revenue.updateMany.mockResolvedValue({} as any);
      mp.revenue.update.mockResolvedValue({} as any);

      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.autoTagged).toBeGreaterThan(0);
      expect(data.autoLinked).toBeGreaterThan(0);
    });

    it('handles missing source and skips short names', async () => {
      mp.revenue.findMany.mockResolvedValue([
        { id: 'r1', source: null, month: new Date('2024-01-01'), type: 'one_time' },
        { id: 'r2', source: 'ab', month: new Date('2024-02-01'), type: 'one_time' } // < 3 chars
      ] as any);
      mp.client.findMany.mockResolvedValue([]);
      
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.autoTagged).toBe(0);
    });

    it('returns 500 on unexpected exception', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(makeReq());
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/revenue'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 for invalid payload', async () => {
      const res = await POST(makeReq({}));
      expect(res.status).toBe(400);
    });

    it('creates revenue successfully', async () => {
      mp.revenue.create.mockResolvedValue({ id: 'r1' } as any);
      const res = await POST(makeReq({ month: '2024-01-01', amount: 1000, source: 'Stripe' }));
      expect(res.status).toBe(201);
      expect(mp.revenue.create).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exception', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await POST(makeReq({ month: '2024-01-01', amount: 1000, source: 'Stripe' }));
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/revenue'), {
        method: 'PATCH',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 if source missing', async () => {
      const res = await PATCH(makeReq({ type: 'recurring' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 if nothing to update', async () => {
      const res = await PATCH(makeReq({ source: 'Stripe' }));
      expect(res.status).toBe(400);
    });

    it('updates revenue successfully', async () => {
      mp.revenue.updateMany.mockResolvedValue({ count: 5 } as any);
      const res = await PATCH(makeReq({ source: 'Stripe', type: 'recurring', clientId: 'c1' }));
      expect(res.status).toBe(200);
      expect(mp.revenue.updateMany).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exception', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await PATCH(makeReq({ source: 'Stripe', type: 'recurring' }));
      expect(res.status).toBe(500);
    });
  it('hits missing false branches in revenue auto-detection', async () => {
    // We want to hit false branches in `extractCleanName` and `fuzzyMatchClient`
    mp.revenue.findMany.mockResolvedValue([
      { id: '1', source: '', month: new Date(), type: 'one-time' }, // source empty -> !raw return ""
      { id: '2', source: 'A B C D', month: new Date(), type: 'one-time' }, // started && nameTokens.length >= 2 break;
      { id: '3', source: 'GRS/REF123 Some Name', month: new Date(), type: 'recurring' }, // r.type !== "recurring" false branch
      { id: '4', source: 'Some Name~RefNoise', month: new Date(), type: 'one-time' }, // includes("~") true branch
    ] as any);

    mp.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Some Name', company: null }, // match company=null
      { id: 'c2', name: '', company: 'A B C' }, // match name=''
    ] as any);

    const req = new NextRequest('http://localhost/api/revenue');
    const res = await GET(req);
    expect(res.status).toBe(200);

    // Cover from/to false branches
    const reqFrom = new NextRequest('http://localhost/api/revenue?from=2025-01-01');
    await GET(reqFrom);
    
    const reqTo = new NextRequest('http://localhost/api/revenue?to=2025-01-31');
    await GET(reqTo);
  });

  it('covers missing type branch in POST', async () => {
    const req = new NextRequest('http://localhost/api/revenue', {
      method: 'POST',
      body: JSON.stringify({ amount: 100, month: '2025-01-01', source: 'Test' }) // no type
    } as any);
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});
});
