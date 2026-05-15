import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { expenseCategory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/schemas', () => ({ CreateCategorySchema: { safeParse: vi.fn((d:any) => d.name ? { success:true, data:d } : { success:false, error:{ issues:[{message:'Name required'}] } }) } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { GET, POST, DELETE } from '@/app/api/categories/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  mg.mockResolvedValue({ allowed: true, userId:'u1', organizationId:'org-1' } as any);
});

function req(method='GET', url='http://localhost:3008/api/categories', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/categories', () => {
  it('returns categories with expense counts', async () => {
    (mp.expenseCategory.findMany as any).mockResolvedValue([
      { id:'cat-1', name:'SaaS', icon:'💻', color:'#3b82f6', _count:{ expenses:5 } },
      { id:'cat-2', name:'Travel', icon:'✈️', color:'#10b981', _count:{ expenses:2 } },
    ]);
    const res = await GET(); const d = await res.json();
    expect(res.status).toBe(200);
    expect(d).toHaveLength(2);
    expect(d[0].name).toBe('SaaS');
  });

  it('enforces take:500', async () => {
    (mp.expenseCategory.findMany as any).mockResolvedValue([]);
    await GET();
    expect(mp.expenseCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/categories', () => {
  it('creates a category', async () => {
    (mp.expenseCategory.create as any).mockResolvedValue({ id:'cat-new', name:'Marketing', icon:'📣', color:'#f59e0b' });
    const res = await POST(req('POST','http://localhost:3008/api/categories',{ name:'Marketing', icon:'📣', color:'#f59e0b' }));
    expect(res.status).toBe(201);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/categories',{}));
    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate category', async () => {
    (mp.expenseCategory.create as any).mockRejectedValue(new Error('Unique constraint failed'));
    const res = await POST(req('POST','http://localhost:3008/api/categories',{ name:'Existing' }));
    expect(res.status).toBe(409);
  });

  it('returns 500 on other errors', async () => {
    (mp.expenseCategory.create as any).mockRejectedValue(new Error('DB down'));
    const res = await POST(req('POST','http://localhost:3008/api/categories',{ name:'New' }));
    expect(res.status).toBe(500);
  });

  it('returns 500 on string error (non-Error)', async () => {
    (mp.expenseCategory.create as any).mockRejectedValue('Unique constraint failed');
    const res = await POST(req('POST','http://localhost:3008/api/categories',{ name:'New' }));
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/categories', () => {
  it('deletes category by id', async () => {
    (mp.expenseCategory.findFirst as any).mockResolvedValue({ id:'cat-1', name:'SaaS', organizationId:'org-1' });
    (mp.expenseCategory.delete as any).mockResolvedValue({});
    const res = await DELETE(req('DELETE','http://localhost:3008/api/categories?id=cat-1'));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.success).toBe(true);
  });

  it('returns 400 without id', async () => {
    const res = await DELETE(req('DELETE','http://localhost:3008/api/categories'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when category not found', async () => {
    (mp.expenseCategory.findFirst as any).mockResolvedValue(null);
    const res = await DELETE(req('DELETE','http://localhost:3008/api/categories?id=nope'));
    expect(res.status).toBe(404);
  });

  it('returns guard response when permission denied', async () => {
    mg.mockResolvedValue({ allowed: false, response: NextResponse.json({ error: 'Denied' }, { status: 403 }) } as any);
    const res = await DELETE(req('DELETE','http://localhost:3008/api/categories?id=cat-1'));
    expect(res.status).toBe(403);
  });

  it('returns 500 on error', async () => {
    (mp.expenseCategory.delete as any).mockRejectedValue(new Error('FK constraint'));
    (mp.expenseCategory.findFirst as any).mockResolvedValue({ id:'cat-1' });
    const res = await DELETE(req('DELETE','http://localhost:3008/api/categories?id=cat-1'));
    expect(res.status).toBe(500);
  });
});
