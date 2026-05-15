import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
    payrollRun: { findMany: vi.fn() }
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/tds/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });

  (mp.expense.findMany as any).mockResolvedValue([]);
  (mp.payrollRun.findMany as any).mockResolvedValue([]);
});

function req(quarter?: string): NextRequest {
  const url = new URL('http://localhost:3008/api/tds');
  if (quarter) url.searchParams.set('quarter', quarter);
  return new NextRequest(url);
}

describe('GET /api/tds', () => {
  it('returns empty TDS when no expenses match', async () => {
    const res = await GET(req('Q1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.totalTDS).toBe(0);
    expect(data.vendors.length).toBe(0);
  });

  it('calculates TDS for Rent and Professional Services', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { vendor: 'Landlord', amount: 300000, category: { name: 'Rent' } }, // Rent 10%
      { vendor: 'Consultant', amount: 50000, category: { name: 'Professional Services' } }, // Prof 10%
      { vendor: 'IT Co', amount: 10000, category: { name: 'Infrastructure' } }, // Infra 2%
      { vendor: 'Ignored', amount: 50000, category: { name: 'Software' } }, // Not TDS applicable
      { amount: 10000, category: { name: 'Professional Services' } } // No vendor name
    ]);

    const res = await GET(req('Q2'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    const landlord = data.vendors.find((v: any) => v.vendor === 'Landlord');
    expect(landlord.tdsSection).toBe('194I(b)');
    expect(landlord.totalAmount).toBe(300000);

    const consultant = data.vendors.find((v: any) => v.vendor === 'Consultant');
    expect(consultant.tdsSection).toBe('194J(b)');
    
    const unknown = data.vendors.find((v: any) => v.vendor === 'Unknown Vendor');
    expect(unknown).toBeDefined();
    
    expect(data.summary.totalTDS).toBeGreaterThan(0);
  });

  it('calculates TDS for Contractor Payroll Runs', async () => {
    (mp.payrollRun.findMany as any).mockResolvedValue([
      { grossPay: 40000, employee: { name: 'John', paymentBasis: 'hourly' } }, // Prof
      { grossPay: 20000, employee: { name: 'Jane', designation: 'Software Engineer' } }, // Prof
      { grossPay: 30000, employee: { name: 'Bob', designation: 'Worker' } } // 194C 1% or 2%
    ]);

    const res = await GET(req('Q3'));
    const data = await res.json();
    
    const john = data.vendors.find((v: any) => v.vendor === 'John');
    expect(john.tdsSection).toBe('194J(b)');
    
    const bob = data.vendors.find((v: any) => v.vendor === 'Bob');
    expect(bob.tdsSection).toBe('194C');
  });

  it('returns 400 for invalid quarter parameter', async () => {
    const res = await GET(req('INVALID'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
