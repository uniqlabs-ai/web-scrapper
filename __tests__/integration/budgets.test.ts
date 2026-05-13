import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    budgetThreshold: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    expense: { findMany: vi.fn() },
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
import { GET, POST, DELETE } from '@/app/api/budgets/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  mg.mockResolvedValue({ allowed: true, userId:'u1', organizationId:'org-1' } as any);
});

function req(method='GET', url='http://localhost:3008/api/budgets', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/budgets', () => {
  it('returns budgets with spend actuals', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId:'org-1' } as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { id:'b1', category:'SaaS', monthlyLimit:100000, alertAt:0.8 },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount:60000, category:{ name:'SaaS' } },
    ] as any);

    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.budgets).toHaveLength(1);
    expect(d.budgets[0].spent).toBe(60000);
    expect(d.budgets[0].utilization).toBe(60);
    expect(d.budgets[0].isOverBudget).toBe(false);
    expect(d.summary.totalBudget).toBe(100000);
  });

  it('returns empty when user has no org', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId: null } as any);
    const res = await GET();
    const d = await res.json();
    expect(d.budgets).toEqual([]);
  });

  it('detects over-budget status', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId:'org-1' } as any);
    mp.budgetThreshold.findMany.mockResolvedValue([
      { id:'b1', category:'Travel', monthlyLimit:50000, alertAt:0.8 },
    ] as any);
    mp.expense.findMany.mockResolvedValue([
      { amount:60000, category:{ name:'Travel' } },
    ] as any);

    const res = await GET();
    const d = await res.json();
    expect(d.budgets[0].isOverBudget).toBe(true);
    expect(d.budgets[0].isWarning).toBe(true);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/budgets', () => {
  it('creates a new budget', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId:'org-1' } as any);
    mp.budgetThreshold.findFirst.mockResolvedValue(null);
    mp.budgetThreshold.create.mockResolvedValue({ id:'b-new', category:'Marketing', monthlyLimit:200000, alertAt:0.8 } as any);

    const res = await POST(req('POST','http://localhost:3008/api/budgets',{ category:'Marketing', monthlyLimit:200000 }));
    expect(res.status).toBe(201);
  });

  it('updates existing budget for same category', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId:'org-1' } as any);
    mp.budgetThreshold.findFirst.mockResolvedValue({ id:'b-existing' } as any);
    mp.budgetThreshold.update.mockResolvedValue({ id:'b-existing', category:'SaaS', monthlyLimit:150000 } as any);

    const res = await POST(req('POST','http://localhost:3008/api/budgets',{ category:'SaaS', monthlyLimit:150000 }));
    expect(res.status).toBe(201);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/budgets',{ category:'' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when user has no org', async () => {
    mp.user.findUnique.mockResolvedValue({ organizationId: null } as any);
    const res = await POST(req('POST','http://localhost:3008/api/budgets',{ category:'SaaS', monthlyLimit:100000 }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mp.user.findUnique.mockRejectedValue(new Error('DB'));
    const res = await POST(req('POST','http://localhost:3008/api/budgets',{ category:'SaaS', monthlyLimit:100000 }));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/budgets', () => {
  it('deletes budget by id', async () => {
    mp.budgetThreshold.findFirst.mockResolvedValue({ id:'b1', category:'SaaS', organizationId:'org-1' } as any);
    mp.budgetThreshold.delete.mockResolvedValue({} as any);
    const res = await DELETE(req('DELETE','http://localhost:3008/api/budgets?id=b1'));
    expect(res.status).toBe(200);
  });

  it('returns 400 without id', async () => {
    const res = await DELETE(req('DELETE','http://localhost:3008/api/budgets'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when budget not found', async () => {
    mp.budgetThreshold.findFirst.mockResolvedValue(null);
    const res = await DELETE(req('DELETE','http://localhost:3008/api/budgets?id=nope'));
    expect(res.status).toBe(404);
  });

  it('returns guard response when permission denied', async () => {
    const { NextResponse } = await import('next/server');
    mg.mockResolvedValue({ allowed: false, response: NextResponse.json({ error: 'Denied' }, { status: 403 }) } as any);
    const res = await DELETE(req('DELETE','http://localhost:3008/api/budgets?id=b1'));
    expect(res.status).toBe(403);
  });
});
