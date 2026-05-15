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

const mockRequirePermission = vi.fn();
vi.mock('@/lib/guards', () => ({ requirePermission: (...args: any[]) => mockRequirePermission(...args) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { GET, PUT, DELETE } from '@/app/api/payroll/[id]/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue({ allowed: true });
});

function req(method='GET', body?:unknown, id: string='test-id'): [NextRequest, { params: Promise<{id:string}> }] {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return [new NextRequest(new URL(`http://localhost:3008/api/payroll/${id}`), init), { params: Promise.resolve({ id }) }];
}

const employee = { id:'emp-1', name:'John Doe', aliases:'["JD"]', userId:'u1' };

describe('payroll/[id]', () => {
  describe('GET', () => {
    it('returns employee detail with expenses and consistent variance', async () => {
      (mp.employee.findFirst as any).mockResolvedValue(employee);
      (mp.expense.findMany as any).mockResolvedValue([
        { id:'e1', amount:50000, description:'Salary John Doe', date:new Date('2024-04-01'), category:{ name:'Salary', color:'#22c55e' } },
        { id:'e2', amount:50000, description:'Salary JD', date:new Date('2024-05-01'), category:{ name:'Salary', color:'#22c55e' } },
      ]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      const d = await res.json();
      expect(res.status).toBe(200);
      expect(d.totalPaid).toBe(100000);
      expect(d.isConsistent).toBe(true);
      expect(d.transactions[0].matchedVia).toBeNull();
      expect(d.transactions[1].matchedVia).toBe('JD'); // matched via alias
    });

    it('returns employee detail with expenses and inconsistent variance', async () => {
      (mp.employee.findFirst as any).mockResolvedValue(employee);
      (mp.expense.findMany as any).mockResolvedValue([
        { id:'e1', amount:50000, description:'Salary John Doe', date:new Date('2024-04-01') },
        { id:'e2', amount:20000, description:'Bonus John Doe', date:new Date('2024-05-01') },
      ]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      const d = await res.json();
      expect(res.status).toBe(200);
      expect(d.isConsistent).toBe(false);
    });

    it('returns 404 when employee not found', async () => {
      (mp.employee.findFirst as any).mockResolvedValue(null);
      const res = await GET(...req('GET', undefined, 'missing'));
      expect(res.status).toBe(404);
    });

    it('handles malformed aliases gracefully in GET and transaction matching', async () => {
      (mp.employee.findFirst as any).mockResolvedValue({ ...employee, aliases: 'invalid json' });
      (mp.expense.findMany as any).mockResolvedValue([
        { id:'e1', amount:50000, description:'Salary John Doe', date:new Date('2024-04-01') }
      ]);
      const res = await GET(...req());
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.transactions[0].matchedVia).toBeNull(); // didn't crash
    });

    it('handles tenant error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(...req());
      expect(res.status).toBe(500);
    });

    it('uses matchedVia alias when alias is longer than primary name', async () => {
      (mp.employee.findFirst as any).mockResolvedValue({ id: 'emp-1', name: 'JD', aliases: '["John Doe"]', userId: 'u1' });
      (mp.expense.findMany as any).mockResolvedValue([
        { id: 'e1', amount: 50000, description: 'Salary John Doe JD', date: new Date('2024-04-01') },
      ]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      const d = await res.json();
      expect(res.status).toBe(200);
      expect(d.transactions[0].matchedVia).toBe('John Doe');
    });

    it('handles employee with no expenses (empty transactions)', async () => {
      (mp.employee.findFirst as any).mockResolvedValue(employee);
      (mp.expense.findMany as any).mockResolvedValue([]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      const d = await res.json();
      expect(d.totalPaid).toBe(0);
      expect(d.isConsistent).toBe(false);
      expect(d.transactions).toHaveLength(0);
    });

    it('handles single expense (variance = 0)', async () => {
      (mp.employee.findFirst as any).mockResolvedValue(employee);
      (mp.expense.findMany as any).mockResolvedValue([
        { id: 'e1', amount: 50000, description: 'Salary John Doe', date: new Date('2024-04-01') },
      ]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      const d = await res.json();
      expect(d.isConsistent).toBe(true); // variance is 0
    });

    it('returns null category when expense has no category relation', async () => {
      (mp.employee.findFirst as any).mockResolvedValue(employee);
      (mp.expense.findMany as any).mockResolvedValue([
        { id: 'e1', amount: 50000, description: 'Salary John Doe', date: new Date('2024-04-01'), category: null },
      ]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      const d = await res.json();
      expect(d.transactions[0].category).toBeNull();
      expect(d.transactions[0].categoryColor).toBeNull();
    });

    it('handles employee with empty aliases', async () => {
      (mp.employee.findFirst as any).mockResolvedValue({ id: 'emp-1', name: 'John', aliases: null, userId: 'u1' });
      (mp.expense.findMany as any).mockResolvedValue([{ id: 'e1', description: 'test', amount: 100, date: new Date(), category: null }]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      expect(res.status).toBe(200);
    });

    it('handles JSON.parse throwing string error', async () => {
      (mp.employee.findFirst as any).mockResolvedValue({ id: 'emp-1', name: 'John', aliases: 'invalid', userId: 'u1' });
      (mp.expense.findMany as any).mockResolvedValue([{ id: 'e1', description: 'test', amount: 100, date: new Date() }]);
      const originalParse = JSON.parse;
      JSON.parse = vi.fn().mockImplementation(() => { throw "String error"; });
      const res = await GET(...req('GET', undefined, 'emp-1'));
      JSON.parse = originalParse;
      expect(res.status).toBe(200);
    });

    it('does not use alias when both match but alias is shorter', async () => {
      (mp.employee.findFirst as any).mockResolvedValue({ id: 'emp-1', name: 'Johnathan', aliases: '["John"]', userId: 'u1' });
      (mp.expense.findMany as any).mockResolvedValue([
        { id: 'e1', amount: 50000, description: 'Salary Johnathan', date: new Date('2024-04-01') },
      ]);
      const res = await GET(...req('GET', undefined, 'emp-1'));
      const d = await res.json();
      expect(res.status).toBe(200);
      expect(d.transactions[0].matchedVia).toBeNull();
    });
  });

  describe('PUT', () => {
    it('returns 403 if permission denied', async () => {
      mockRequirePermission.mockResolvedValue({ allowed: false, response: new Response('Forbidden', { status: 403 }) });
      const res = await PUT(...req('PUT', { name:'Jane Doe' }));
      expect(res.status).toBe(403);
    });

    it('updates employee with allowed fields and ignoring invalid fields', async () => {
      (mp.employee.findFirst as any).mockResolvedValue(employee);
      (mp.employee.update as any).mockResolvedValue({ ...employee, name:'Jane Doe' });
      const res = await PUT(...req('PUT', { name:'Jane Doe', basicSalary:'60000', invalidField: 'test' }));
      expect(res.status).toBe(200);
      expect(mp.employee.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'Jane Doe', basicSalary: 60000 })
      }));
    });

    it('rejects non-numeric salary with 400 validation error', async () => {
      // Zod's z.coerce.number().min(0) converts 'invalid' to NaN, which fails validation
      const res = await PUT(...req('PUT', { basicSalary: 'invalid' }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid payload');
      expect(data.details).toBeDefined();
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

  describe('DELETE', () => {
    it('returns 403 if permission denied', async () => {
      mockRequirePermission.mockResolvedValue({ allowed: false, response: new Response('Forbidden', { status: 403 }) });
      const res = await DELETE(...req('DELETE', undefined, 'emp-1'));
      expect(res.status).toBe(403);
    });

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
});
