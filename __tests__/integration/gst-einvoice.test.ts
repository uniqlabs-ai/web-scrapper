import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/gst/einvoice/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('GET /api/gst/einvoice', () => {
  function req(query: string = ''): NextRequest {
    return new NextRequest(new URL(`http://localhost:3008/api/gst/einvoice${query}`));
  }

  it('returns 400 if invoiceId is missing', async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it('returns 404 if invoice not found', async () => {
    mp.invoice.findFirst.mockResolvedValue(null);
    const res = await GET(req('?invoiceId=inv-1'));
    expect(res.status).toBe(404);
  });

  it('generates einvoice JSON correctly (INTRA)', async () => {
    mp.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-001',
      issueDate: new Date('2024-05-15'),
      isInterState: false,
      subtotal: 1000,
      total: 1180,
      client: { gstNumber: '29ABCDE1234F1Z5', name: 'Acme', address: 'Bangalore' },
      lineItems: [
        { description: 'Service A', quantity: 1, unitPrice: 1000, amount: 1000, cgst: 90, sgst: 90, igst: 0 }
      ]
    } as any);

    mp.organization.findFirst.mockResolvedValue({
      name: 'Seller Org',
      gstNumber: '29SELLER1234F1Z5',
      address: 'Seller Address'
    } as any);

    const res = await GET(req('?invoiceId=inv-1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.eInvoice.TranDtls.SupTyp).toBe('INTRA');
    expect(data.eInvoice.SellerDtls.LglNm).toBe('Seller Org');
    expect(data.eInvoice.BuyerDtls.LglNm).toBe('Acme');
    expect(data.eInvoice.ItemList.length).toBe(1);
    expect(data.eInvoice.ValDtls.TotInvVal).toBe(1180);
  });

  it('generates einvoice JSON correctly (INTER) with missing client/org details', async () => {
    mp.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-001',
      issueDate: new Date('2024-05-15'),
      isInterState: true,
      subtotal: 1000,
      total: 1180,
      client: null,
      lineItems: [
        { description: 'Service B', quantity: 2, unitPrice: 500, amount: 1000, cgst: 0, sgst: 0, igst: 180 }
      ]
    } as any);

    mp.organization.findFirst.mockResolvedValue(null);

    const res = await GET(req('?invoiceId=inv-1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.eInvoice.TranDtls.SupTyp).toBe('INTER');
    expect(data.eInvoice.SellerDtls.LglNm).toBe('Seller'); // fallback
    expect(data.eInvoice.BuyerDtls.LglNm).toBe('Buyer'); // fallback
    expect(data.eInvoice.ValDtls.IgstVal).toBe(180);
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req('?invoiceId=inv-1'));
    expect(res.status).toBe(500);
  });
});
