import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    revenue: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    client: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/schemas', () => ({ CreateRevenueSchema: { safeParse: vi.fn((d:any) => d.amount ? { success:true, data:d } : { success:false, error:{ issues:[{message:'Amount required'}] } }) } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST, PATCH } from '@/app/api/revenue/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  mp.client.findMany.mockResolvedValue([]);
});

function req(method='GET', url='http://localhost:3008/api/revenue', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/revenue', () => {
  it('returns revenues', async () => {
    mp.revenue.findMany.mockResolvedValue([
      { id:'r1', amount:100000, type:'recurring', month:new Date('2025-04-01'), source:'SaaS', client:null, clientId:null },
    ] as any);
    const res = await GET(req()); const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.revenues).toHaveLength(1);
    expect(d.autoTagged).toBe(0);
  });

  it('applies date filters', async () => {
    mp.revenue.findMany.mockResolvedValue([]);
    await GET(req('GET','http://localhost:3008/api/revenue?from=2025-04-01&to=2025-06-30'));
    expect(mp.revenue.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ month: expect.objectContaining({ gte: expect.any(Date) }) }),
    }));
  });

  it('enforces take:500', async () => {
    mp.revenue.findMany.mockResolvedValue([]);
    await GET(req());
    expect(mp.revenue.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/revenue', () => {
  it('creates revenue entry', async () => {
    mp.revenue.create.mockResolvedValue({ id:'r-new', amount:50000, type:'recurring', month:new Date('2025-04-01'), client:null } as any);
    const res = await POST(req('POST','http://localhost:3008/api/revenue',{ month:'2025-04-01', amount:50000, source:'SaaS' }));
    expect(res.status).toBe(201);
    const d = await res.json();
    expect(d.revenue.amount).toBe(50000);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/revenue',{}));
    expect(res.status).toBe(400);
  });

  it('returns 500 on Prisma error', async () => {
    mp.revenue.create.mockRejectedValue(new Error('DB error'));
    const res = await POST(req('POST','http://localhost:3008/api/revenue',{ month:'2025-04-01', amount:50000 }));
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/revenue', () => {
  it('bulk updates revenue by source', async () => {
    mp.revenue.updateMany.mockResolvedValue({ count: 3 } as any);
    const res = await PATCH(req('PATCH','http://localhost:3008/api/revenue',{ source:'SaaS', type:'recurring' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.updated).toBe(3);
  });

  it('returns 400 without source', async () => {
    const res = await PATCH(req('PATCH','http://localhost:3008/api/revenue',{ type:'recurring' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when nothing to update', async () => {
    const res = await PATCH(req('PATCH','http://localhost:3008/api/revenue',{ source:'SaaS' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mp.revenue.updateMany.mockRejectedValue(new Error('DB error'));
    const res = await PATCH(req('PATCH','http://localhost:3008/api/revenue',{ source:'SaaS', type:'one-time' }));
    expect(res.status).toBe(500);
  });
});
