import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
    organization: { findFirst: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/tds/form16a/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('GET /api/tds/form16a', () => {
  it('returns 403 if gst setup is incomplete', async () => {
    mp.organization.findFirst.mockResolvedValue({ id: 'org-1', gstNumber: '' } as any);
    mp.expense.findMany.mockResolvedValue([
      { vendor: 'Acme', amount: 1000, category: { name: 'Professional Services' } }
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/tds/form16a'));
    const res = await GET(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Government Tax Setup Incomplete');
  });

  it('generates Form 16A certificates successfully', async () => {
    mp.organization.findFirst.mockResolvedValue({ id: 'org-1', gstNumber: 'GST123' } as any);
    mp.expense.findMany.mockResolvedValue([
      { vendor: 'Acme', amount: 10000, category: { name: 'Professional Services' } }, // 10%
      { vendor: 'Acme', amount: 5000, category: { name: 'Contractor' } }, // 2%
      { vendor: 'Unknown', amount: 2000, category: { name: 'Misc' } } // 1%
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/tds/form16a?quarter=Q2'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.certificates.length).toBe(2); // Acme and Unknown
    
    const acmeCert = data.certificates.find((c: any) => c.deducteeName === 'Acme');
    expect(acmeCert.totalAmountPaid).toBe(15000);
    expect(acmeCert.totalTdsDeducted).toBe(1100); // 1000 + 100
  });

  it('filters by vendorId if provided', async () => {
    mp.organization.findFirst.mockResolvedValue({ id: 'org-1', gstNumber: 'GST123' } as any);
    mp.expense.findMany.mockResolvedValue([] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/tds/form16a?vendorId=v1'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mp.expense.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: 'v1' })
    }));
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const req = new NextRequest(new URL('http://localhost:3008/api/tds/form16a'));
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});
