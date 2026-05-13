import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { client: { findMany: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/schemas', () => ({ CreateClientSchema: { safeParse: vi.fn((d:any) => d.name ? { success:true, data:d } : { success:false, error:{ issues:[{message:'Name required'}] } }) } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/clients/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method='GET', url='http://localhost:3008/api/clients', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/clients', () => {
  it('returns clients with billing summaries', async () => {
    mp.client.findMany.mockResolvedValue([
      {
        id:'c1', name:'Acme Corp', email:'acme@test.com', company:'Acme',
        invoices: [{ id:'inv-1', total:100000, currency:'INR', status:'paid', issueDate:new Date() }],
        revenues: [{ id:'r-1', amount:100000, month:new Date(), type:'recurring' }],
      },
    ] as any);

    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.clients).toHaveLength(1);
    expect(d.clients[0].totalInvoiced).toBe(100000);
    expect(d.clients[0].totalRevenue).toBe(100000);
    expect(d.clients[0].invoiceCount).toBe(1);
  });

  it('applies date filters', async () => {
    mp.client.findMany.mockResolvedValue([]);
    await GET(req('GET','http://localhost:3008/api/clients?from=2025-04-01&to=2025-06-30'));
    expect(mp.client.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it('handles clients with no invoices or revenue', async () => {
    mp.client.findMany.mockResolvedValue([
      { id:'c2', name:'Empty Client', invoices:[], revenues:[] },
    ] as any);
    const res = await GET(req());
    const d = await res.json();
    expect(d.clients[0].totalInvoiced).toBe(0);
    expect(d.clients[0].latestInvoiceCurrency).toBe('INR');
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/clients', () => {
  it('creates a client', async () => {
    mp.client.create.mockResolvedValue({ id:'c-new', name:'NewCorp', userId:'u1' } as any);
    const res = await POST(req('POST','http://localhost:3008/api/clients',{ name:'NewCorp', email:'new@corp.com' }));
    expect(res.status).toBe(201);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/clients',{}));
    expect(res.status).toBe(400);
  });

  it('returns 403 for TenantError', async () => {
    const { TenantError } = await import('@/lib/tenant');
    mt.mockRejectedValue(new TenantError('No org'));
    const res = await POST(req('POST','http://localhost:3008/api/clients',{ name:'Test' }));
    expect(res.status).toBe(403);
  });

  it('returns 500 on Prisma error', async () => {
    mp.client.create.mockRejectedValue(new Error('DB error'));
    const res = await POST(req('POST','http://localhost:3008/api/clients',{ name:'Test' }));
    expect(res.status).toBe(500);
  });
});
