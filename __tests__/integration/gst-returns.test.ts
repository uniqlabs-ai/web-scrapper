import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/gst/returns/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(url='http://localhost:3008/api/gst/returns'): NextRequest {
  return new NextRequest(new URL(url), { method: 'GET' });
}

describe('GET /api/gst/returns', () => {
  describe('GSTR-3B (default)', () => {
    it('returns summary with outward supplies and ITC', async () => {
      (mp.invoice.findMany as any).mockResolvedValue([
        { subtotal:100000, lineItems:[{ cgst:9000, sgst:9000, igst:0 }] },
      ]);
      (mp.expense.findMany as any).mockResolvedValue([
        { amount:50000, receipt:'receipt.pdf' },
        { amount:30000, receipt:null },
      ]);
      const res = await GET(req('http://localhost:3008/api/gst/returns?month=2025-04'));
      const d = await res.json();
      expect(res.status).toBe(200);
      expect(d.type).toBe('gstr3b');
      expect(d.outwardSupplies.taxableValue).toBe(100000);
      expect(d.outwardSupplies.cgst).toBe(9000);
      expect(d.inputTaxCredit.expenseCount).toBe(1); // only with receipts
      expect(d.netTaxPayable.total).toBeGreaterThan(0);
    });

    it('handles empty invoices and expenses', async () => {
      (mp.invoice.findMany as any).mockResolvedValue([]);
      (mp.expense.findMany as any).mockResolvedValue([]);
      const res = await GET(req());
      const d = await res.json();
      expect(d.outwardSupplies.taxableValue).toBe(0);
      expect(d.netTaxPayable.total).toBe(0);
    });
  });

  describe('GSTR-1', () => {
    it('returns B2B and B2C invoice breakdown', async () => {
      (mp.invoice.findMany as any).mockResolvedValue([
        {
          invoiceNumber:'INV-001', subtotal:100000, total:118000, issueDate:new Date('2025-04-10'),
          placeOfSupply: null, isInterState:false,
          client: { name: '', gstNumber: '29XYZ', company: null },
          lineItems:[{ cgst:9000, sgst:9000, igst:0 }],
        },
        {
          invoiceNumber:'INV-002', subtotal:50000, total:59000, issueDate:new Date('2025-04-12'),
          placeOfSupply:'29-Karnataka', isInterState:false,
          client:{ name:'Local Customer', gstNumber:null, company:null },
          lineItems:[{ cgst:4500, sgst:4500, igst:0 }],
        },
        {
          invoiceNumber:'INV-003', subtotal:20000, total:23600, issueDate:new Date('2025-04-15'),
          placeOfSupply:'27-Maharashtra', isInterState:true,
          client:{ name:'Interstate Corp', gstNumber:'27AABCU1234F1Z5', company:'Interstate' },
          lineItems:[{ cgst:0, sgst:0, igst:3600 }],
        },
      ]);
      const res = await GET(req('http://localhost:3008/api/gst/returns?type=gstr1&month=2025-04'));
      const d = await res.json();
      expect(d.type).toBe('gstr1');
      expect(d.b2b.count).toBe(2);
      expect(d.b2c.count).toBe(1);
      expect(d.totalInvoices).toBe(3);
    });
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
