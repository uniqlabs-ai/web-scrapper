import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn(), updateMany: vi.fn() },
    bankTransaction: { updateMany: vi.fn() },
    expenseCategory: { findUnique: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/vendors/fingerprints/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/vendors/fingerprints', () => {
  describe('GET', () => {
    it('returns empty fingerprints if no expenses', async () => {
      mp.expense.findMany.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fingerprints.length).toBe(0);
    });

    it('returns fingerprints with consistency calculation', async () => {
      mp.expense.findMany.mockResolvedValue([
        { vendor: 'Zoom', amount: 100, category: { name: 'Software', color: '#111' } },
        { vendor: 'Zoom', amount: 100, category: { name: 'Software', color: '#111' } },
        { vendor: 'Zoom', amount: 100, category: { name: 'Software', color: '#111' } },
        { vendor: 'Amazon', amount: 50, category: { name: 'Office Supplies', color: '#222' } },
        { vendor: 'Amazon', amount: 50, category: null }, // Uncategorized
        { vendor: null, amount: 10, category: null } // Unknown vendor
      ] as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.fingerprints.length).toBe(3); // Zoom, Amazon, Unknown
      
      const zoom = data.fingerprints.find((f: any) => f.vendor === 'Zoom');
      expect(zoom.confidence).toBe(100);
      expect(zoom.isConsistent).toBe(true);

      const amazon = data.fingerprints.find((f: any) => f.vendor === 'Amazon');
      expect(amazon.confidence).toBe(50);
      expect(amazon.isConsistent).toBe(false);

      expect(data.summary.totalVendors).toBe(3);
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/vendors/fingerprints'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 if vendor or categoryId missing', async () => {
      const res = await POST(makeReq({ vendor: 'Zoom' }));
      expect(res.status).toBe(400);
    });

    it('updates expenses and bank transactions correctly', async () => {
      mp.expense.updateMany.mockResolvedValue({ count: 5 } as any);
      mp.expenseCategory.findUnique.mockResolvedValue({ name: 'Software' } as any);
      mp.bankTransaction.updateMany.mockResolvedValue({} as any);

      const validCategoryId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      const res = await POST(makeReq({ vendor: 'Zoom', categoryId: validCategoryId }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.updated).toBe(5);
      expect(mp.expense.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { categoryId: validCategoryId }
      }));
      expect(mp.bankTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { category: 'Software' }
      }));
    });

    it('handles category not found', async () => {
      mp.expense.updateMany.mockResolvedValue({ count: 5 } as any);
      mp.expenseCategory.findUnique.mockResolvedValue(null);
      mp.bankTransaction.updateMany.mockResolvedValue({} as any);

      const validCategoryId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
      const res = await POST(makeReq({ vendor: 'Zoom', categoryId: validCategoryId }));
      expect(res.status).toBe(200);
      expect(mp.bankTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { category: 'Zoom' } // Fallback to vendor name
      }));
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await POST(makeReq({ vendor: 'Zoom', categoryId: 'cat-1' }));
      expect(res.status).toBe(500);
    });
  });
});
