import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    employee: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
    recurringExpense: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { POST } from '@/app/api/transfer/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, response: null } as any);
  mp.user.findUnique.mockResolvedValue({ organizationId: 'org-1' } as any);
});

function req(body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/transfer'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  } as Record<string, unknown>);
}

describe('POST /api/transfer', () => {
  describe('validation', () => {
    it('returns 400 for invalid payload - missing sourceType', async () => {
      const res = await POST(req({ sourceId: 'id1', targetType: 'payroll' }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid payload');
    });

    it('returns 400 for invalid payload - invalid sourceType', async () => {
      const res = await POST(req({ sourceType: 'invalid', sourceId: 'id1', targetType: 'payroll' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty sourceId', async () => {
      const res = await POST(req({ sourceType: 'payroll', sourceId: '', targetType: 'recurring' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when source and target types are the same', async () => {
      const res = await POST(req({ sourceType: 'payroll', sourceId: 'id1', targetType: 'payroll' }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Source and target types must be different');
    });
  });

  describe('permission guard', () => {
    it('returns guard response when permission denied', async () => {
      const guardRes = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      mg.mockResolvedValue({ allowed: false, response: guardRes } as any);
      const res = await POST(req({ sourceType: 'payroll', sourceId: 'id1', targetType: 'recurring' }));
      expect(res.status).toBe(403);
    });
  });

  describe('payroll → recurring', () => {
    it('transfers employee to recurring expense successfully', async () => {
      const employee = {
        id: 'emp-1', name: 'John Doe', basicSalary: 50000,
        joinDate: new Date('2025-01-01'), isActive: true,
        employeeId: 'EMP-001', designation: 'Engineer', type: 'employee', aliases: '[]'
      };
      mp.employee.findFirst.mockResolvedValue(employee as any);
      mp.recurringExpense.create.mockResolvedValue({ id: 'rec-new' } as any);
      mp.employee.delete.mockResolvedValue(employee as any);

      const res = await POST(req({ sourceType: 'payroll', sourceId: 'emp-1', targetType: 'recurring' }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.newId).toBe('rec-new');
      expect(data.message).toContain('payroll to recurring');
    });

    it('includes designation in notes when present', async () => {
      const employee = {
        id: 'emp-1', name: 'Jane', basicSalary: 60000,
        joinDate: new Date(), isActive: true, employeeId: 'EMP-002',
        designation: 'Sr Developer', type: 'employee', aliases: null
      };
      mp.employee.findFirst.mockResolvedValue(employee as any);
      mp.recurringExpense.create.mockResolvedValue({ id: 'rec-2' } as any);
      mp.employee.delete.mockResolvedValue({} as any);

      await POST(req({ sourceType: 'payroll', sourceId: 'emp-1', targetType: 'recurring' }));
      const createCall = mp.recurringExpense.create.mock.calls[0][0] as any;
      expect(createCall.data.notes).toContain('Role: Sr Developer');
    });

    it('includes contractor note when type is contractor', async () => {
      const employee = {
        id: 'emp-1', name: 'Contractor', basicSalary: 40000,
        joinDate: new Date(), isActive: true, employeeId: 'EMP-003',
        designation: null, type: 'contractor', aliases: null
      };
      mp.employee.findFirst.mockResolvedValue(employee as any);
      mp.recurringExpense.create.mockResolvedValue({ id: 'rec-3' } as any);
      mp.employee.delete.mockResolvedValue({} as any);

      await POST(req({ sourceType: 'payroll', sourceId: 'emp-1', targetType: 'recurring' }));
      const createCall = mp.recurringExpense.create.mock.calls[0][0] as any;
      expect(createCall.data.notes).toContain('Was a contractor');
    });

    it('returns 404 when employee not found', async () => {
      mp.employee.findFirst.mockResolvedValue(null);
      const res = await POST(req({ sourceType: 'payroll', sourceId: 'emp-missing', targetType: 'recurring' }));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Employee not found');
    });
  });

  describe('recurring → payroll', () => {
    it('transfers recurring expense to payroll successfully', async () => {
      const recurring = {
        id: 'rec-1', description: 'AWS Monthly', amount: 30000,
        startDate: new Date('2025-01-01'), isActive: true, aliases: '[]'
      };
      mp.recurringExpense.findFirst.mockResolvedValue(recurring as any);
      mp.employee.count.mockResolvedValue(5);
      mp.employee.create.mockResolvedValue({ id: 'emp-new' } as any);
      mp.recurringExpense.delete.mockResolvedValue({} as any);

      const res = await POST(req({ sourceType: 'recurring', sourceId: 'rec-1', targetType: 'payroll' }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.newId).toBe('emp-new');
    });

    it('generates correct employee ID based on count', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue({ id: 'rec-1', description: 'Test', amount: 10000, startDate: new Date(), isActive: true, aliases: null } as any);
      mp.employee.count.mockResolvedValue(9);
      mp.employee.create.mockResolvedValue({ id: 'emp-new' } as any);
      mp.recurringExpense.delete.mockResolvedValue({} as any);

      await POST(req({ sourceType: 'recurring', sourceId: 'rec-1', targetType: 'payroll' }));
      const createCall = mp.employee.create.mock.calls[0][0] as any;
      expect(createCall.data.employeeId).toBe('EMP-010');
      expect(createCall.data.type).toBe('contractor');
      expect(createCall.data.ctc).toBe(120000); // 10000 * 12
    });

    it('returns 404 when recurring expense not found', async () => {
      mp.recurringExpense.findFirst.mockResolvedValue(null);
      const res = await POST(req({ sourceType: 'recurring', sourceId: 'rec-missing', targetType: 'payroll' }));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Recurring expense not found');
    });
  });

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mt.mockRejectedValue(new Error('unexpected'));
      const res = await POST(req({ sourceType: 'payroll', sourceId: 'id1', targetType: 'recurring' }));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Transfer failed');
    });
  });
});
