import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findMany: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/schemas', () => ({ CreateBankAccountSchema: { safeParse: vi.fn((d:any) => d.name ? { success:true, data:d } : { success:false, error:{ issues:[{message:'Name required'}] } }) } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/accounts/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method="GET", url="http://localhost:3008/api/test", body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/accounts', () => {
  it('returns accounts for tenant', async () => {
    mp.account.findMany.mockResolvedValue([{ id:'acc-1', name:'HDFC Current', type:'bank', currentBalance:500000 }] as any);
    const res = await GET(); const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.accounts).toHaveLength(1);
    expect(d.accounts[0].name).toBe('HDFC Current');
  });

  it('enforces take:500', async () => {
    mp.account.findMany.mockResolvedValue([]);
    await GET();
    expect(mp.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it('returns 403 for TenantError', async () => {
    const { TenantError } = await import('@/lib/tenant');
    mt.mockRejectedValue(new TenantError('No org'));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/accounts', () => {
  it('creates a bank account', async () => {
    mp.account.create.mockResolvedValue({ id:'acc-new', name:'SBI Savings', type:'bank', currentBalance:0 } as any);
    const res = await POST(req('POST','http://localhost:3008/api/accounts',{ name:'SBI Savings', accountType:'bank', currentBalance:0, currency:'INR' }));
    expect(res.status).toBe(201);
    const d = await res.json();
    expect(d.account.name).toBe('SBI Savings');
  });

  it('returns 400 for invalid payload', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/accounts',{}));
    expect(res.status).toBe(400);
  });

  it('returns 403 for TenantError', async () => {
    const { TenantError } = await import('@/lib/tenant');
    mt.mockRejectedValue(new TenantError('No org'));
    const res = await POST(req('POST','http://localhost:3008/api/accounts',{ name:'Test' }));
    expect(res.status).toBe(403);
  });

  it('returns 500 on Prisma error', async () => {
    mp.account.create.mockRejectedValue(new Error('DB error'));
    const res = await POST(req('POST','http://localhost:3008/api/accounts',{ name:'Test' }));
    expect(res.status).toBe(500);
  });
});
