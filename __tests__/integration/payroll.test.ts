import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    payrollRun: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    bankAccount: { findFirst: vi.fn(), update: vi.fn() },
    bankTransaction: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/tds', () => ({ calculateTDS: vi.fn().mockReturnValue({ tdsAmount: 5000, section: '194J(b)' }) }));
vi.mock('@/lib/payouts', () => ({
  createRazorpayContact: vi.fn().mockResolvedValue('cont_123'),
  createFundAccount: vi.fn().mockResolvedValue('fa_456'),
  executePayout: vi.fn().mockResolvedValue('pout_789'),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/payroll/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  (mp.user.findUnique as any).mockResolvedValue({ organizationId:'org-1' });
});

function req(method='GET', url='http://localhost:3008/api/payroll', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/payroll', () => {
  it('returns employees list (default view)', async () => {
    (mp.employee.findMany as any).mockResolvedValue([
      { id:'e1', employeeId:'EMP-001', name:'Alice', email:'a@test.com', designation:'Engineer', department:'Engineering', basicSalary:50000, hra:20000, ctc:1200000, isActive:true, type:'employee', paymentBasis:null, joinDate:new Date(), aliases:'[]' },
    ]);
    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.employees).toHaveLength(1);
    expect(d.employees[0].name).toBe('Alice');
  });

  it('returns payroll runs for a specific month', async () => {
    (mp.payrollRun.findMany as any).mockResolvedValue([
      { id:'r1', grossPay:70000, totalDeductions:10000, netPay:60000, pfEmployer:1800, esiEmployer:0, status:'processed', pfEmployee:1800, esiEmployee:0, professionalTax:200, tds:5000, employee:{ employeeId:'EMP-001', name:'Alice', designation:'Engineer' } },
    ]);
    const res = await GET(req('GET','http://localhost:3008/api/payroll?view=runs&month=2025-04'));
    const d = await res.json();
    expect(d.month).toBe('2025-04');
    expect(d.runs).toHaveLength(1);
    expect(d.summary.totalGross).toBe(70000);
    expect(d.summary.companyCost).toBe(71800);
  });

  it('filters out alias-duplicated employees', async () => {
    (mp.employee.findMany as any).mockResolvedValue([
      { id:'e1', employeeId:'EMP-001', name:'Alice Smith', aliases:'["alice","ali"]', basicSalary:50000, hra:20000, ctc:1200000, isActive:true, type:'employee', paymentBasis:null, joinDate:new Date(), email:null, designation:null, department:null },
      { id:'e2', employeeId:'EMP-002', name:'Alice', aliases:'[]', basicSalary:30000, hra:10000, ctc:600000, isActive:true, type:'employee', paymentBasis:null, joinDate:new Date(), email:null, designation:null, department:null },
    ]);
    const res = await GET(req());
    const d = await res.json();
    // 'Alice' matches alias 'alice' owned by e1, and e2 is not e1, so e2 is filtered
    expect(d.employees).toHaveLength(1);
    expect(d.employees[0].name).toBe('Alice Smith');
  });

  it('handles malformed aliases JSON in employee', async () => {
    (mp.employee.findMany as any).mockResolvedValue([
      { id:'e1', employeeId:'EMP-001', name:'Alice', aliases:'{{invalid}', basicSalary:50000, hra:20000, ctc:1200000, isActive:true, type:'employee', paymentBasis:null, joinDate:new Date(), email:null, designation:null, department:null },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.employees).toHaveLength(1);
  });

  it('handles null aliases in employee', async () => {
    (mp.employee.findMany as any).mockResolvedValue([
      { id:'e1', employeeId:'EMP-001', name:'Alice', aliases:null, basicSalary:50000, hra:20000, ctc:1200000, isActive:true, type:'employee', paymentBasis:null, joinDate:new Date(), email:null, designation:null, department:null },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.employees).toHaveLength(1);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/payroll', () => {
  it('adds an employee', async () => {
    (mp.employee.count as any).mockResolvedValue(5);
    (mp.employee.create as any).mockResolvedValue({ id:'e-new', employeeId:'EMP-006', name:'Bob' });
    const res = await POST(req('POST','http://localhost:3008/api/payroll',{ action:'add_employee', name:'Bob', designation:'Designer', basicSalary:40000 }));
    expect(res.status).toBe(201);
  });

  it('generates CON prefix for contractors', async () => {
    (mp.employee.count as any).mockResolvedValue(0);
    (mp.employee.create as any).mockResolvedValue({ id:'c-new', employeeId:'CON-001', name:'Contractor' });
    const res = await POST(req('POST','http://localhost:3008/api/payroll',{ action:'add_employee', name:'Contractor', type:'contractor', basicSalary:50000 }));
    expect(res.status).toBe(201);
    expect(mp.employee.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ employeeId: 'CON-001' }),
    }));
  });

  it('runs payroll for a month with employees and contractors', async () => {
    (mp.payrollRun.findFirst as any).mockResolvedValue(null);
    (mp.employee.findMany as any).mockResolvedValue([
      { id:'e1', basicSalary:50000, hra:20000, da:0, specialAllowance:0, otherAllowance:0, type:'employee', paymentBasis:null, designation:'Engineer' },
      { id:'e2', basicSalary:50000, hra:0, da:0, specialAllowance:0, otherAllowance:0, type:'contractor', paymentBasis:'hourly', designation:'Consultant' },
    ]);
    (mp.payrollRun.create as any).mockResolvedValue({ id:'run-1' });

    const res = await POST(req('POST','http://localhost:3008/api/payroll',{ action:'run_payroll', month:'2025-04' }));
    const d = await res.json();
    expect(res.status).toBe(201);
    expect(d.processed).toBe(2);
    expect(d.month).toBe('2025-04');
  });

  it('prevents duplicate payroll run for same month', async () => {
    (mp.payrollRun.findFirst as any).mockResolvedValue({ id:'existing' });
    const res = await POST(req('POST','http://localhost:3008/api/payroll',{ action:'run_payroll', month:'2025-04' }));
    expect(res.status).toBe(409);
  });

  it('returns 400 when month missing for run_payroll', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/payroll',{ action:'run_payroll' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid action', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/payroll',{ action:'invalid' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST','http://localhost:3008/api/payroll',{ action:'add_employee', name:'X' }));
    expect(res.status).toBe(500);
  });
});
