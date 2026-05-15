import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vendor: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    expense: { groupBy: vi.fn(), updateMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST, PATCH, DELETE } from '@/app/api/vendors/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/vendors', () => {
  describe('GET', () => {
    it('returns vendors with total spent', async () => {
      mp.vendor.findMany.mockResolvedValue([
        { id: 'v1', name: 'Vendor 1', createdAt: new Date(), _count: { expenses: 1 } },
        { id: 'v2', name: 'Vendor 2', createdAt: new Date(), _count: { expenses: 0 } }
      ] as any);
      mp.expense.groupBy.mockResolvedValue([
        { vendorId: 'v1', _sum: { amount: 1000 }, _count: 1 }
      ] as any);

      const req = new NextRequest(new URL('http://localhost:3008/api/vendors?from=2024-01-01&to=2024-01-31'));
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.vendors.length).toBe(2);
      expect(data.vendors[0].totalSpent).toBe(1000);
      expect(data.vendors[1].totalSpent).toBe(0);
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(new NextRequest(new URL('http://localhost:3008/api/vendors')));
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/vendors'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 for invalid payload', async () => {
      const res = await POST(makeReq({}));
      expect(res.status).toBe(400);
    });

    it('creates vendor and links existing expenses', async () => {
      mp.vendor.create.mockResolvedValue({ id: 'v1', name: 'VendorName' } as any);
      mp.expense.updateMany.mockResolvedValue({ count: 2 } as any);

      const res = await POST(makeReq({ name: 'VendorName' }));
      expect(res.status).toBe(201);
      expect(mp.vendor.create).toHaveBeenCalled();
      expect(mp.expense.updateMany).toHaveBeenCalledTimes(2); // One for description, one for vendor field
    });

    it('returns 409 if vendor exists', async () => {
      mp.vendor.create.mockRejectedValue({ code: 'P2002' });
      const res = await POST(makeReq({ name: 'Dup' }));
      expect(res.status).toBe(409);
    });

    it('returns 500 on unexpected error', async () => {
      mp.vendor.create.mockRejectedValue(new Error('DB down'));
      const res = await POST(makeReq({ name: 'Dup' }));
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/vendors'), {
        method: 'PATCH',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('relinks all vendors if relink=true', async () => {
      mp.vendor.findMany.mockResolvedValue([
        { id: 'v1', name: 'Abc' },
        { id: 'v2', name: 'A' } // Skipped due to length < 3
      ] as any);
      mp.expense.updateMany.mockResolvedValue({ count: 1 } as any);

      const res = await PATCH(makeReq({ relink: true }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.linked).toBe(2); // 1 + 1 from two updateMany calls
    });

    it('returns 400 if ID missing in normal update', async () => {
      const res = await PATCH(makeReq({ name: 'New' }));
      expect(res.status).toBe(400);
    });

    it('updates vendor successfully', async () => {
      mp.vendor.update.mockResolvedValue({ id: 'v1', name: 'New' } as any);
      const res = await PATCH(makeReq({ id: 'v1', name: 'New' }));
      expect(res.status).toBe(200);
      expect(mp.vendor.update).toHaveBeenCalled();
    });

    it('returns 500 on unexpected error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await PATCH(makeReq({ id: 'v1' }));
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    function makeReq(id?: string): NextRequest {
      const url = id ? `http://localhost:3008/api/vendors?id=${id}` : 'http://localhost:3008/api/vendors';
      return new NextRequest(new URL(url), { method: 'DELETE' });
    }

    it('returns 400 if ID missing', async () => {
      const res = await DELETE(makeReq());
      expect(res.status).toBe(400);
    });

    it('returns 404 if vendor not found', async () => {
      mp.vendor.findFirst.mockResolvedValue(null);
      const res = await DELETE(makeReq('v1'));
      expect(res.status).toBe(404);
    });

    it('deletes vendor successfully', async () => {
      mp.vendor.findFirst.mockResolvedValue({ id: 'v1', name: 'V' } as any);
      const res = await DELETE(makeReq('v1'));
      expect(res.status).toBe(200);
      expect(mp.vendor.delete).toHaveBeenCalled();
    });

    it('returns 500 on unexpected error', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await DELETE(makeReq('v1'));
      expect(res.status).toBe(500);
    });
  });
});
