import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findMany: vi.fn(), create: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((ops) => ops({
      payment: { create: vi.fn().mockResolvedValue({ id: 'p-1', amount: 500, date: new Date(), method: 'cash', reference: 'ref' }) },
      invoice: { update: vi.fn() }
    })),
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/invoices/[id]/payments/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/invoices/[id]/payments', () => {
  describe('GET', () => {
    function makeReq(): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1/payments'), { method: 'GET' });
    }

    it('returns 500 on unexpected exceptions', async () => {
      vi.mocked(prisma.payment.findMany).mockRejectedValue(new Error('fail'));
      const res = await GET(makeReq(), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(500);
    });

    it('returns payments and summary successfully', async () => {
      vi.mocked(prisma.payment.findMany).mockResolvedValue([
        { id: 'p1', amount: 500, date: new Date(), method: 'bank_transfer', reference: '', notes: '' }
      ] as any);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 'inv-1', total: 1000, status: 'sent' } as any);

      const res = await GET(makeReq(), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.payments.length).toBe(1);
      expect(data.summary.invoiceTotal).toBe(1000);
      expect(data.summary.totalPaid).toBe(500);
      expect(data.summary.balance).toBe(500);
      expect(data.summary.isFullyPaid).toBe(false);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1/payments'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 if invalid payload', async () => {
      const res = await POST(makeReq({ amount: -100 }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(400);
    });

    it('returns 404 if invoice not found', async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
      const res = await POST(makeReq({ amount: 100 }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(404);
    });

    it('returns 400 if amount exceeds remaining balance', async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 'inv-1', total: 1000 } as any);
      vi.mocked(prisma.payment.findMany).mockResolvedValue([{ amount: 500 }] as any);
      
      const res = await POST(makeReq({ amount: 600 }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(400);
    });

    it('creates payment successfully and updates to partial', async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 'inv-1', total: 1000, status: 'sent' } as any);
      vi.mocked(prisma.payment.findMany).mockResolvedValue([] as any);

      const res = await POST(makeReq({ amount: 500, method: 'cash' }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.invoiceStatus).toBe('partial');
    });

    it('creates payment successfully with date and method and updates to paid', async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 'inv-1', total: 1000, status: 'partial' } as any);
      vi.mocked(prisma.payment.findMany).mockResolvedValue([{ amount: 500 }] as any);

      const res = await POST(makeReq({ amount: 500, method: 'cash', date: '2025-01-01' }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.invoiceStatus).toBe('paid');
    });

    it('creates payment without method and keeps status partial if already partial', async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 'inv-1', total: 1000, status: 'partial' } as any);
      vi.mocked(prisma.payment.findMany).mockResolvedValue([{ amount: 200 }] as any);

      const res = await POST(makeReq({ amount: 100 }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.invoiceStatus).toBe('partial');
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await POST(makeReq({ amount: 100 }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(500);
    });
  });
});
