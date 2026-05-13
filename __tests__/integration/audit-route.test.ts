import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { auditLog: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/audit/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method='GET', url='http://localhost:3008/api/audit', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/audit', () => {
  it('returns paginated audit logs', async () => {
    mp.auditLog.findMany.mockResolvedValue([
      { id:'a1', action:'create', resource:'invoice', resourceId:'inv-1', details:'{"total":50000}', createdAt:new Date('2025-04-10') },
    ] as any);
    mp.auditLog.count.mockResolvedValue(1);

    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0].details).toEqual({ total: 50000 });
    expect(d.total).toBe(1);
    expect(d.limit).toBe(50);
    expect(d.offset).toBe(0);
  });

  it('applies resource and action filters', async () => {
    mp.auditLog.findMany.mockResolvedValue([]);
    mp.auditLog.count.mockResolvedValue(0);
    await GET(req('GET','http://localhost:3008/api/audit?resource=expense&action=delete'));
    expect(mp.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ resource: 'expense', action: 'delete' }),
    }));
  });

  it('caps limit at 200', async () => {
    mp.auditLog.findMany.mockResolvedValue([]);
    mp.auditLog.count.mockResolvedValue(0);
    const res = await GET(req('GET','http://localhost:3008/api/audit?limit=500'));
    const d = await res.json();
    expect(d.limit).toBe(200);
  });

  it('handles null details', async () => {
    mp.auditLog.findMany.mockResolvedValue([
      { id:'a2', action:'delete', resource:'vendor', resourceId:'v1', details:null, createdAt:new Date() },
    ] as any);
    mp.auditLog.count.mockResolvedValue(1);
    const res = await GET(req());
    const d = await res.json();
    expect(d.entries[0].details).toBeNull();
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/audit', () => {
  it('creates audit log entry', async () => {
    mp.auditLog.create.mockResolvedValue({} as any);
    const res = await POST(req('POST','http://localhost:3008/api/audit',{ action:'create', resource:'invoice', resourceId:'inv-1', details:{ total:50000 } }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.success).toBe(true);
  });

  it('handles null details', async () => {
    mp.auditLog.create.mockResolvedValue({} as any);
    const res = await POST(req('POST','http://localhost:3008/api/audit',{ action:'delete', resource:'expense' }));
    expect(res.status).toBe(200);
    expect(mp.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ details: null }),
    }));
  });

  it('returns 500 on error', async () => {
    mp.auditLog.create.mockRejectedValue(new Error('DB'));
    const res = await POST(req('POST','http://localhost:3008/api/audit',{ action:'create', resource:'test' }));
    expect(res.status).toBe(500);
  });
});
