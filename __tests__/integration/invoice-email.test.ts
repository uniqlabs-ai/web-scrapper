import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { invoice: { findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/pdf', () => ({ generateInvoicePDF: vi.fn().mockReturnValue(Buffer.from('PDF')) }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/invoices/[id]/email/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mockParams = { params: Promise.resolve({ id: 'inv-1' }) };
const origFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});
afterEach(() => { global.fetch = origFetch; });

function req(): NextRequest { return new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1/email'), { method:'POST' }); }

const fullInvoice = {
  id:'inv-1', invoiceNumber:'INV-001', subtotal:100000, taxTotal:18000, total:118000,
  issueDate:new Date('2025-04-01'), dueDate:new Date('2025-05-01'), status:'sent',
  currency:'INR', isInterState:false, notes:'Test',
  client:{ name:'Acme', email:'billing@acme.com', company:'Acme Inc', address:'BLR', gstNumber:'29AABCU1234F1Z5' },
  lineItems:[{ description:'Consulting', quantity:1, unitPrice:100000, amount:100000, gstRate:18, cgst:9000, sgst:9000, igst:0, total:118000 }],
  organization:{ name:'MyCompany', address:'HSR', gstNumber:'29XXXXX', alertSettings:'{"paymentUpiId":"test@upi"}' },
};

describe('POST /api/invoices/[id]/email', () => {
  it('returns 404 when invoice not found', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue(null);
    const res = await POST(req(), mockParams as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when client has no email', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      ...fullInvoice, client: { ...fullInvoice.client, email: null },
    });
    const res = await POST(req(), mockParams as any);
    expect(res.status).toBe(400);
  });

  it('returns 503 when RESEND_API_KEY not configured', async () => {
    delete process.env.RESEND_API_KEY;
    (mp.invoice.findFirst as any).mockResolvedValue(fullInvoice);
    const res = await POST(req(), mockParams as any);
    expect(res.status).toBe(503);
  });

  it('sends email successfully', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    (mp.invoice.findFirst as any).mockResolvedValue(fullInvoice);
    (mp.invoice.update as any).mockResolvedValue({});
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'email-1' }) });

    const res = await POST(req(), mockParams as any);
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
    delete process.env.RESEND_API_KEY;
  });

  it('returns 502 when Resend API fails', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    (mp.invoice.findFirst as any).mockResolvedValue(fullInvoice);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, text: async () => 'Rate limit exceeded' });

    const res = await POST(req(), mockParams as any);
    expect(res.status).toBe(502);
    delete process.env.RESEND_API_KEY;
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req(), mockParams as any);
    expect(res.status).toBe(500);
  });
});
