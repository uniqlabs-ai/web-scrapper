import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    expense: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, PUT, DELETE } from '@/app/api/payroll/[id]/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method='GET', body?:unknown, id: string='test-id'): [NextRequest, { params: Promise<{id:string}> }] {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return [new NextRequest(new URL('http://localhost:3008/api/payroll/[id]'), init), { params: Promise.resolve({ id }) }];
}

const employee = { id:'emp-1', name:'John Doe', aliases:'["John D","JD"]', userId:'u1' };

describe('GET /api/payroll/[id]', () => {
  it('returns employee detail with expenses', async () => {
    (mp.employee.findFirst as any).mockResolvedValue(employee);
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'e1', amount:50000, description:'Salary John Doe', date:new Date('2025-04-01'), category:{ name:'Salary', color:'#22c55e' } },
    ]);
    const res = await GET(...req('GET', undefined, 'emp-1'));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.employee).toBeDefined();
    expect(d.totalPaid).toBe(50000);
  });

  it('returns 404 when employee not found', async () => {
    (mp.employee.findFirst as any).mockResolvedValue(null);
    const res = await GET(...req('GET', undefined, 'missing'));
    expect(res.status).toBe(404);
  });

  it('handles malformed aliases gracefully', async () => {
    (mp.employee.findFirst as any).mockResolvedValue({ ...employee, aliases: 'invalid json' });
    (mp.expense.findMany as any).mockResolvedValue([]);
    const res = await GET(...req());
    expect(res.status).toBe(200);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(...req());
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/payroll/[id]', () => {
  it('updates employee', async () => {
    (mp.employee.findFirst as any).mockResolvedValue(employee);
    (mp.employee.update as any).mockResolvedValue({ ...employee, name:'Jane Doe' });
    const res = await PUT(...req('PUT', { name:'Jane Doe', basicSalary:'60000' }));
    expect(res.status).toBe(200);
  });

  it('returns 404 when employee not found', async () => {
    (mp.employee.findFirst as any).mockResolvedValue(null);
    const res = await PUT(...req('PUT', { name:'X' }));
    expect(res.status).toBe(404);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await PUT(...req('PUT', { name:'X' }));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/payroll/[id]', () => {
  it('deletes employee', async () => {
    (mp.employee.findFirst as any).mockResolvedValue(employee);
    (mp.employee.delete as any).mockResolvedValue(employee);
    const res = await DELETE(...req('DELETE', undefined, 'emp-1'));
    expect(res.status).toBe(200);
  });

  it('returns 404 when employee not found', async () => {
    (mp.employee.findFirst as any).mockResolvedValue(null);
    const res = await DELETE(...req('DELETE', undefined, 'missing'));
    expect(res.status).toBe(404);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await DELETE(...req());
    expect(res.status).toBe(500);
  });
});

