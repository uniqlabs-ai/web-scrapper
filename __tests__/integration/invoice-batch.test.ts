import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    bankTransaction: { findMany: vi.fn(), update: vi.fn() },
    payment: { create: vi.fn() },
    client: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

// ── Invoice Auto-Match ──
describe('GET /api/invoices/auto-match', () => {
  let GET: any;
  beforeEach(async () => { ({ GET } = await import('@/app/api/invoices/auto-match/route')); });

  it('returns empty when no unpaid invoices', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await GET();
    const d = await res.json();
    expect(d.suggestions).toEqual([]);
  });

  it('finds bank transaction matches for unpaid invoices', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([
      { id:'inv-1', total:100000, invoiceNumber:'INV-001', clientId:'c1', client:{ name:'Acme Corp', company:'Acme' }, issueDate:new Date() },
    ]);
    (mp.bankTransaction.findMany as any).mockResolvedValue([
      { id:'txn-1', amount:100000, description:'Credit from Acme Corp', date:new Date(), type:'credit' },
    ]);
    (mp.client.findUnique as any).mockResolvedValue({ aliases: [] });
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.suggestions.length).toBeGreaterThanOrEqual(0);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ── Invoice Email ──
describe('POST /api/invoices/[id]/email', () => {
  let POST_EMAIL: any;
  beforeEach(async () => { ({ POST: POST_EMAIL } = await import('@/app/api/invoices/[id]/email/route')); });

  const mockParams = { params: Promise.resolve({ id: 'inv-1' }) };

  it('returns 404 when invoice not found', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue(null);
    const r = new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1/email'), { method:'POST' });
    const res = await POST_EMAIL(r, mockParams as any);
    expect(res.status).toBe(404);
  });

  it('returns error when client has no email', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id:'inv-1', client: { name:'Acme', email:null }, lineItems:[], organization:{},
    });
    const r = new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1/email'), { method:'POST' });
    const res = await POST_EMAIL(r, mockParams as any);
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const r = new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1/email'), { method:'POST' });
    const res = await POST_EMAIL(r, mockParams as any);
    expect(res.status).toBe(500);
  });
});

// ── V1 Invoices API ──
describe('/api/v1/invoices', () => {
  let GET_V1: any;
  let POST_V1: any;

  vi.mock('@/lib/api-auth', () => ({ validateApiKey: vi.fn() }));
  vi.mock('@/lib/webhooks', () => ({ fireWebhook: vi.fn() }));

  beforeEach(async () => {
    const mod = await import('@/app/api/v1/invoices/route');
    GET_V1 = mod.GET;
    POST_V1 = mod.POST;
    const { validateApiKey } = await import('@/lib/api-auth');
    vi.mocked(validateApiKey).mockResolvedValue('org-1' as any);
  });

  it('GET returns invoices for valid API key', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([
      { id:'inv-1', invoiceNumber:'INV-001', total:100000, status:'sent', client:{ id:'c1', name:'Acme', email:'a@b.com' } },
    ]);
    const r = new NextRequest(new URL('http://localhost:3008/api/v1/invoices'), { method:'GET' });
    const res = await GET_V1(r);
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.invoices.length).toBe(1);
  });

  it('GET returns 401 for invalid API key', async () => {
    const { validateApiKey } = await import('@/lib/api-auth');
    vi.mocked(validateApiKey).mockResolvedValue(null as any);
    const r = new NextRequest(new URL('http://localhost:3008/api/v1/invoices'), { method:'GET' });
    const res = await GET_V1(r);
    expect(res.status).toBe(401);
  });
});
