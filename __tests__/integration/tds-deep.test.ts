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
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('GET /api/tds', () => {
  it('returns tds summary and groups by vendor correctly', async () => {
    mp.expense.findMany.mockResolvedValue([
      { amount: 50000, vendor: 'Acme', category: { name: 'Professional Services' } },
      { amount: 10000, vendor: 'Acme', category: { name: 'Professional Services' } },
      { amount: 400000, vendor: 'Landlord', category: { name: 'Office Rent' } },
      { amount: 2000, vendor: 'Unknown Vendor', category: { name: 'Meals' } } // Should be skipped by category
    ] as any);

    mp.payrollRun.findMany.mockResolvedValue([
      { grossPay: 100000, employee: { name: 'John Doe', type: 'contractor', paymentBasis: 'hourly' } }
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/tds?quarter=Q1'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.summary.vendorCount).toBe(3); // Acme, Landlord, John Doe
    const acme = data.vendors.find((v: any) => v.vendor === 'Acme');
    expect(acme.totalAmount).toBe(60000);
    expect(acme.tdsSection).toBe('194J(b)');
    
    const landlord = data.vendors.find((v: any) => v.vendor === 'Landlord');
    expect(landlord.totalAmount).toBe(400000);
    expect(landlord.tdsSection).toBe('194I(b)');

    const john = data.vendors.find((v: any) => v.vendor === 'John Doe');
    expect(john.totalAmount).toBe(100000);
    expect(john.tdsSection).toBe('194J(b)');
  });

  it('uses fallback quarter if none provided', async () => {
    mp.expense.findMany.mockResolvedValue([] as any);
    mp.payrollRun.findMany.mockResolvedValue([] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/tds'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quarter).toBeDefined();
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const req = new NextRequest(new URL('http://localhost:3008/api/tds'));
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});
