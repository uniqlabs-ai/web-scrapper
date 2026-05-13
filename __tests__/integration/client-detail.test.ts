import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    client: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { GET, PUT, DELETE } from '@/app/api/clients/[id]/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

const mockParams = { params: Promise.resolve({ id: 'client-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  mg.mockResolvedValue({ allowed: true, userId:'u1', organizationId:'org-1' } as any);
});

function req(method='GET', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL('http://localhost:3008/api/clients/client-1'), init);
}

describe('GET /api/clients/[id]', () => {
  it('returns client with computed totals', async () => {
    (mp.client.findFirst as any).mockResolvedValue({
      id:'client-1', name:'Acme Corp', userId:'u1',
      invoices:[
        { id:'inv-1', invoiceNumber:'INV-001', total:100000, currency:'INR', status:'paid', issueDate:new Date('2025-04-01') },
      ],
      revenues:[
        { id:'r-1', amount:100000, month:new Date('2025-04-01'), type:'recurring', source:'SaaS' },
      ],
    });
    const res = await GET(req(), mockParams as any);
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.client.name).toBe('Acme Corp');
    expect(d.totalInvoiced).toBe(100000);
    expect(d.totalRevenue).toBe(100000);
  });

  it('returns 404 when client not found', async () => {
    (mp.client.findFirst as any).mockResolvedValue(null);
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/clients/[id]', () => {
  it('updates client details', async () => {
    (mp.client.update as any).mockResolvedValue({ id:'client-1', name:'Updated Corp', userId:'u1' });
    const res = await PUT(req('PUT', { name:'Updated Corp', email:'new@corp.com' }), mockParams as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when no valid fields provided', async () => {
    const res = await PUT(req('PUT', { invalidField: 'test' }), mockParams as any);
    expect(res.status).toBe(400);
  });

  it('returns 500 on prisma error', async () => {
    (mp.client.update as any).mockRejectedValue(new Error('DB'));
    const res = await PUT(req('PUT', { name:'Test' }), mockParams as any);
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/clients/[id]', () => {
  it('deletes client', async () => {
    (mp.client.findFirst as any).mockResolvedValue({ id:'client-1', name:'Acme' });
    (mp.client.delete as any).mockResolvedValue({});
    const res = await DELETE(req('DELETE'), mockParams as any);
    expect(res.status).toBe(200);
  });

  it('returns 404 when client not found', async () => {
    (mp.client.findFirst as any).mockResolvedValue(null);
    const res = await DELETE(req('DELETE'), mockParams as any);
    expect(res.status).toBe(404);
  });

  it('returns 403 when permission denied', async () => {
    mg.mockResolvedValue({ allowed: false, response: NextResponse.json({ error: 'Denied' }, { status: 403 }) } as any);
    const res = await DELETE(req('DELETE'), mockParams as any);
    expect(res.status).toBe(403);
  });
});
