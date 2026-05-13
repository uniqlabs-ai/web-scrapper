import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    recurringExpense: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bankTransaction: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, PUT, DELETE } from '@/app/api/recurring-expenses/[id]/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mockParams = { params: Promise.resolve({ id: 're-1' }) };

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method='GET', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL('http://localhost:3008/api/recurring-expenses/re-1'), init);
}

describe('GET /api/recurring-expenses/[id]', () => {
  it('returns recurring expense details', async () => {
    (mp.recurringExpense.findFirst as any).mockResolvedValue({ id:'re-1', description:'AWS', amount:5000, frequency:'monthly', aliases:'[]' });
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    (mp.recurringExpense.findFirst as any).mockResolvedValue(null);
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/recurring-expenses/[id]', () => {
  it('updates recurring expense', async () => {
    (mp.recurringExpense.findFirst as any).mockResolvedValue({ id:'re-1' });
    (mp.recurringExpense.update as any).mockResolvedValue({ id:'re-1', amount:6000 });
    const res = await PUT(req('PUT', { amount:6000 }), mockParams as any);
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    (mp.recurringExpense.findFirst as any).mockResolvedValue(null);
    const res = await PUT(req('PUT', { amount:6000 }), mockParams as any);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/recurring-expenses/[id]', () => {
  it('deactivates recurring expense', async () => {
    (mp.recurringExpense.findFirst as any).mockResolvedValue({ id:'re-1' });
    (mp.recurringExpense.update as any).mockResolvedValue({ id:'re-1', isActive:false });
    const res = await DELETE(req('DELETE'), mockParams as any);
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    (mp.recurringExpense.findFirst as any).mockResolvedValue(null);
    const res = await DELETE(req('DELETE'), mockParams as any);
    expect(res.status).toBe(404);
  });
});
