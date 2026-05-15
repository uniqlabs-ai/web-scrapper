import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    employee: { count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    payrollRun: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    bankAccount: { findFirst: vi.fn(), update: vi.fn() },
    bankTransaction: { createMany: vi.fn() },
    $transaction: vi.fn((ops) => Promise.all(ops)),
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/payouts', () => ({
  createRazorpayContact: vi.fn().mockResolvedValue('cont_1'),
  createFundAccount: vi.fn().mockResolvedValue('fa_1'),
  executePayout: vi.fn().mockResolvedValue('pout_1')
}));
vi.mock('@/lib/tds', () => ({ calculateTDS: vi.fn().mockReturnValue({ tdsAmount: 100 }) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/payroll/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ organizationId: 'org-1' } as any);
});

function makeReq(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/payroll'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
}

describe('POST /api/payroll', () => {
  describe('add_employee', () => {
    it('adds an employee', async () => {
      vi.mocked(prisma.employee.count).mockResolvedValue(0);
      vi.mocked(prisma.employee.create).mockResolvedValue({ id: 'emp-1' } as any);
      
      const res = await POST(makeReq({ action: 'add_employee', name: 'John Doe', type: 'employee', basicSalary: 10000 }));
      expect(res.status).toBe(201);
      expect(prisma.employee.create).toHaveBeenCalled();
    });
  });

  describe('run_payroll', () => {
    it('returns 400 if month is missing', async () => {
      const res = await POST(makeReq({ action: 'run_payroll' }));
      expect(res.status).toBe(400);
    });

    it('returns 409 if payroll already run', async () => {
      vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({ id: 'pr-1' } as any);
      const res = await POST(makeReq({ action: 'run_payroll', month: '2024-01' }));
      expect(res.status).toBe(409);
    });

    it('runs payroll successfully for employees and contractors', async () => {
      vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: 'emp-1', type: 'employee', basicSalary: 10000, hra: 5000, da: 0, specialAllowance: 0, otherAllowance: 0 },
        { id: 'emp-2', type: 'contractor', paymentBasis: 'hourly', basicSalary: 20000, hra: 0, da: 0, specialAllowance: 0, otherAllowance: 0 }
      ] as any);
      vi.mocked(prisma.payrollRun.create).mockResolvedValue({ id: 'pr-1' } as any);

      const res = await POST(makeReq({ action: 'run_payroll', month: '2024-01' }));
      expect(res.status).toBe(201);
      expect(prisma.payrollRun.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('pay_payroll', () => {
    it('returns 400 if month is missing', async () => {
      const res = await POST(makeReq({ action: 'pay_payroll' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 if no unprocessed runs', async () => {
      vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([]);
      const res = await POST(makeReq({ action: 'pay_payroll', month: '2024-01' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 if no active bank account', async () => {
      vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: 'pr-1', netPay: 10000, employee: { id: 'emp-1' } }] as any);
      vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue(null);
      
      const res = await POST(makeReq({ action: 'pay_payroll', month: '2024-01' }));
      expect(res.status).toBe(400);
    });

    it('pays payroll successfully', async () => {
      vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: 'pr-1', netPay: 10000, employee: { id: 'emp-1', type: 'employee' } }] as any);
      vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({ id: 'bank-1' } as any);
      
      const res = await POST(makeReq({ action: 'pay_payroll', month: '2024-01' }));
      expect(res.status).toBe(200);
      expect(prisma.bankTransaction.createMany).toHaveBeenCalled();
      expect(prisma.payrollRun.updateMany).toHaveBeenCalled();
      expect(prisma.bankAccount.update).toHaveBeenCalled();
    });
  });

  it('returns 400 for invalid action', async () => {
    const res = await POST(makeReq({ action: 'unknown' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(makeReq({ action: 'add_employee' }));
    expect(res.status).toBe(500);
  });
});
