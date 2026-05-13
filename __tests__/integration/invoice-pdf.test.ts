import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { invoice: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/pdf', () => ({ generateInvoicePDF: vi.fn().mockReturnValue(Buffer.from('PDF')) }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/invoices/[id]/pdf/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mockParams = { params: Promise.resolve({ id: 'inv-1' }) };

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(): NextRequest { return new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1/pdf'), { method:'GET' }); }

describe('GET /api/invoices/[id]/pdf', () => {
  it('generates PDF for valid invoice', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id:'inv-1', invoiceNumber:'INV-001', subtotal:100000, taxTotal:18000, total:118000,
      issueDate:new Date('2025-04-01'), dueDate:new Date('2025-05-01'), status:'sent',
      currency:'INR', isInterState:false, notes:'Test',
      client:{ name:'Acme', email:'a@b.com', company:'Acme Inc', address:'BLR', gstNumber:'29AABCU1234F1Z5' },
      lineItems:[{ description:'Consulting', quantity:1, unitPrice:100000, amount:100000, gstRate:18, cgst:9000, sgst:9000, igst:0, total:118000 }],
      organization:{ name:'MyCompany', address:'HSR', gstNumber:'29XXXXX1234X1Z5', alertSettings:'{"paymentUpiId":"test@upi"}' },
    });
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('returns 404 when invoice not found', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue(null);
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(404);
  });

  it('handles malformed alertSettings gracefully', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id:'inv-1', invoiceNumber:'INV-001', subtotal:0, taxTotal:0, total:0,
      issueDate:new Date(), dueDate:new Date(), status:'draft', currency:'INR', isInterState:false,
      client:null, lineItems:[], organization:{ name:'X', alertSettings:'invalid json' },
    });
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(200);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req(), mockParams as any);
    expect(res.status).toBe(500);
  });
});
