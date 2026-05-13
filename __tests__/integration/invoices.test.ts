import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const invoiceMock = { findMany: vi.fn(), create: vi.fn(), count: vi.fn() };
  return { prisma: { user: { findUnique: vi.fn() }, invoice: invoiceMock, auditLog: { create: vi.fn() }, $transaction: vi.fn(async (cb: any) => cb({ invoice: invoiceMock })) } };
});
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/invoices/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); mp.user.findUnique.mockResolvedValue({ id:'u1', organizationId:'org-1' } as any); });

function req(method="GET", url="http://localhost:3008/api/test", body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/invoices', () => {
  it('returns invoices', async () => {
    mp.invoice.findMany.mockResolvedValue([{id:'inv-1',invoiceNumber:'INV-0001',total:50000,client:null,lineItems:[]}] as any);
    const res = await GET(req()); const data = await res.json();
    expect(res.status).toBe(200); expect(data.invoices).toHaveLength(1);
  });

  it('filters by status', async () => {
    mp.invoice.findMany.mockResolvedValue([]);
    await GET(req('GET','http://localhost:3008/api/invoices?status=paid'));
    expect(mp.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({status:'paid'})}));
  });

  it('filters by date range', async () => {
    mp.invoice.findMany.mockResolvedValue([]);
    await GET(req('GET','http://localhost:3008/api/invoices?from=2025-04-01&to=2025-06-30'));
    expect(mp.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({issueDate:expect.objectContaining({gte:expect.any(Date)})})}));
  });

  it('enforces take:500', async () => {
    mp.invoice.findMany.mockResolvedValue([]);
    await GET(req());
    expect(mp.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({take:500}));
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req()); expect(res.status).toBe(500);
  });
});

describe('POST /api/invoices', () => {
  it('creates invoice', async () => {
    mp.invoice.count.mockResolvedValue(5);
    mp.invoice.create.mockResolvedValue({id:'inv-new',invoiceNumber:'INV-0006',userId:'u1',total:59000,lineItems:[],client:null} as any);
    const res = await POST(req('POST','http://localhost:3008/api/invoices',{dueDate:'2025-06-30',lineItems:[{description:'Dev',quantity:1,unitPrice:50000,gstRate:18}]}));
    expect(res.status).toBe(201);
  });

  it('returns 400 for empty lineItems', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/invoices',{dueDate:'2025-06-30',lineItems:[]}));
    expect(res.status).toBe(400);
  });

  it('calculates GST intra-state (CGST+SGST)', async () => {
    mp.invoice.count.mockResolvedValue(0);
    (mp.invoice.create as ReturnType<typeof vi.fn>).mockImplementation(async(a:{data:Record<string,unknown> & {lineItems:{create:unknown[]}}})=>({id:'inv',invoiceNumber:'INV-0001',userId:'u1',...a.data,lineItems:a.data.lineItems.create,client:null}));
    const res = await POST(req('POST','http://localhost:3008/api/invoices',{dueDate:'2025-06-30',isInterState:false,lineItems:[{description:'C',quantity:1,unitPrice:10000,gstRate:18}]}));
    const d = await res.json();
    expect(d.invoice.lineItems[0].cgst).toBe(900); expect(d.invoice.lineItems[0].igst).toBe(0);
  });

  it('returns 500 on Prisma error', async () => {
    mp.invoice.count.mockResolvedValue(0); mp.invoice.create.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST','http://localhost:3008/api/invoices',{dueDate:'2025-06-30',lineItems:[{description:'T',quantity:1,unitPrice:100,gstRate:18}]}));
    expect(res.status).toBe(500);
  });
});
