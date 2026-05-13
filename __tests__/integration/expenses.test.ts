import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { expense: { findMany: vi.fn(), create: vi.fn(), aggregate: vi.fn() }, account: { update: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn() },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/expenses/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method="GET", url="http://localhost:3008/api/test", body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/expenses', () => {
  it('returns expenses', async () => {
    mp.expense.findMany.mockResolvedValue([{id:'e1',description:'AWS',amount:15000}] as any);
    const res = await GET(req()); const data = await res.json();
    expect(res.status).toBe(200); expect(data.expenses).toHaveLength(1);
  });

  it('enforces take:500', async () => {
    mp.expense.findMany.mockResolvedValue([]);
    await GET(req());
    expect(mp.expense.findMany).toHaveBeenCalledWith(expect.objectContaining({take:500}));
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req()); expect(res.status).toBe(500);
  });
});

describe('POST /api/expenses', () => {
  it('creates expense via transaction', async () => {
    mp.$transaction.mockImplementation(async(cb:any)=>cb({
      expense:{create:vi.fn().mockResolvedValue({id:'e-new',userId:'u1',description:'AWS',amount:15000,category:null})},
      account:{update:vi.fn()},
    }));
    const res = await POST(req('POST','http://localhost:3008/api/expenses',{description:'AWS',amount:15000,date:'2025-04-15'}));
    expect(res.status).toBe(201);
  });

  it('returns 400 for missing description', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/expenses',{amount:1000}));
    expect(res.status).toBe(400);
  });

  it('returns 500 on transaction failure', async () => {
    mp.$transaction.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST','http://localhost:3008/api/expenses',{description:'T',amount:100}));
    expect(res.status).toBe(500);
  });
});
