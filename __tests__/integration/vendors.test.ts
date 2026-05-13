import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { vendor: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }, expense: { groupBy: vi.fn(), updateMany: vi.fn() }, user: { findUnique: vi.fn() }, auditLog: { create: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));
vi.mock('@/lib/schemas', () => ({ CreateVendorSchema: { safeParse: vi.fn((d:any) => d.name ? { success:true, data:d } : { success:false, error:{ issues:[{message:'Name required'}] } }) } }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST, PATCH, DELETE } from '@/app/api/vendors/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method="GET", url="http://localhost:3008/api/test", body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/vendors', () => {
  it('returns vendors', async () => {
    mp.vendor.findMany.mockResolvedValue([{id:'v1',name:'AWS',email:null,phone:null,company:null,gstNumber:null,panNumber:null,paymentTerms:30,isActive:true,createdAt:new Date(),_count:{expenses:5}}] as any);
    (mp.expense.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([{vendorId:'v1',_sum:{amount:150000},_count:5}] as unknown[]);
    const res = await GET(req()); const d = await res.json();
    expect(res.status).toBe(200); expect(d.vendors[0].totalSpent).toBe(150000);
  });

  it('enforces take:500', async () => {
    mp.vendor.findMany.mockResolvedValue([]); (mp.expense.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(req());
    expect(mp.vendor.findMany).toHaveBeenCalledWith(expect.objectContaining({take:500}));
  });
});

describe('POST /api/vendors', () => {
  it('creates vendor', async () => {
    mp.vendor.create.mockResolvedValue({id:'v-new',name:'Vercel',userId:'u1'} as any);
    mp.expense.updateMany.mockResolvedValue({count:0} as any);
    const res = await POST(req('POST','http://localhost:3008/api/vendors',{name:'Vercel'}));
    expect(res.status).toBe(201);
  });

  it('returns 400 without name', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/vendors',{}));
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate (P2002)', async () => {
    const e = new Error('dup'); (e as any).code='P2002';
    mp.vendor.create.mockRejectedValue(e);
    const res = await POST(req('POST','http://localhost:3008/api/vendors',{name:'Dup'}));
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/vendors', () => {
  it('deletes by id', async () => {
    mp.vendor.findFirst.mockResolvedValue({ id:'v1', name:'AWS', organizationId:'org-1' } as any);
    mp.vendor.delete.mockResolvedValue({} as any);
    const res = await DELETE(req('DELETE','http://localhost:3008/api/vendors?id=v1'));
    expect(res.status).toBe(200);
  });

  it('returns 400 without id', async () => {
    const res = await DELETE(req('DELETE','http://localhost:3008/api/vendors'));
    expect(res.status).toBe(400);
  });
});
