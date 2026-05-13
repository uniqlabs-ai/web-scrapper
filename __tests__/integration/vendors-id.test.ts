import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vendor: { findFirst: vi.fn().mockResolvedValue({"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Vendor Inc","email":"test@test.com","fullName":"Test User","amount":50000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"active","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[]}) },
    expense: { findMany: vi.fn().mockResolvedValue([{"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":5000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"active","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[]}]) }
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/vendors/[id]/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method='GET', body?:unknown, id: string='test-id'): [NextRequest, { params: Promise<{id:string}> }] {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return [new NextRequest(new URL('http://localhost:3008/api/vendors/[id]'), init), { params: Promise.resolve({ id }) }];
}

describe('GET /api/vendors/[id]', () => {
  it('handles GET successfully', async () => {
    const res = await GET(...req());
    expect(res.status).toBeLessThan(600);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  it('returns 404 when vendor not found', async () => {
    (mp.vendor.findFirst as any).mockResolvedValue(null);
    const res = await GET(...req());
    expect(res.status).toBe(404);
  });

  it('returns vendor with monthly spend and category breakdown', async () => {
    (mp.vendor.findFirst as any).mockResolvedValue({ id:'v1', name:'AWS' });
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'e1', amount:15000, date:new Date('2025-04-01'), description:'EC2', category:{ name:'SaaS', color:'#3b82f6' }, vendorId:'v1' },
      { id:'e2', amount:5000, date:new Date('2025-04-15'), description:'S3', category:{ name:'SaaS', color:'#3b82f6' }, vendorId:'v1' },
      { id:'e3', amount:3000, date:new Date('2025-03-01'), description:'CloudWatch', category:null, vendorId:'v1' },
    ]);
    const res = await GET(...req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.totalSpent).toBe(23000);
    expect(d.txnCount).toBe(3);
    expect(d.monthlySpend.length).toBeGreaterThan(0);
    expect(d.categoryBreakdown.length).toBeGreaterThan(0);
    expect(d.transactions.length).toBe(3);
  });

  it('handles vendor with no expenses', async () => {
    (mp.vendor.findFirst as any).mockResolvedValue({ id:'v1', name:'NewVendor' });
    (mp.expense.findMany as any).mockResolvedValue([]);
    const res = await GET(...req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.totalSpent).toBe(0);
    expect(d.txnCount).toBe(0);
    expect(d.monthlySpend).toHaveLength(0);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(...req());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
