import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/pdf', () => ({ generateInvoicePDF: vi.fn().mockReturnValue(Buffer.from('pdf-data')) }));

global.fetch = vi.fn();

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/invoices/[id]/email/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);
const mFetch = vi.mocked(global.fetch);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  process.env.RESEND_API_KEY = 'test-key';
  mFetch.mockResolvedValue({ ok: true, text: async () => 'OK' } as any);
});

function req(id: string='inv-1'): [NextRequest, { params: Promise<{id:string}> }] {
  return [new NextRequest(new URL(`http://localhost:3008/api/invoices/${id}/email`), { method: 'POST' }), { params: Promise.resolve({ id }) }];
}

describe('POST /api/invoices/[id]/email', () => {
  it('returns 404 if invoice not found', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue(null);
    const res = await POST(...req());
    expect(res.status).toBe(404);
  });

  it('returns 400 if client has no email', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id: 'inv-1', client: { email: null }
    });
    const res = await POST(...req());
    expect(res.status).toBe(400);
  });

  it('returns 503 if RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY;
    (mp.invoice.findFirst as any).mockResolvedValue({
      id: 'inv-1', client: { email: 'test@example.com' }, lineItems: [], issueDate: new Date(), dueDate: new Date()
    });
    const res = await POST(...req());
    expect(res.status).toBe(503);
  });

  it('sends email successfully with payment UPI ID', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'INV-123', total: 1000,
      client: { name: 'Acme', email: 'test@example.com' },
      organization: { name: 'Org', alertSettings: JSON.stringify({ paymentUpiId: 'test@upi' }) },
      lineItems: [{ quantity: 1, unitPrice: 1000, amount: 1000 }],
      issueDate: new Date(), dueDate: new Date()
    });

    const res = await POST(...req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mFetch).toHaveBeenCalled();
    expect(mp.invoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'sent' } }));
  });

  it('handles malformed alertSettings gracefully', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'INV-123', total: 1000,
      client: { name: 'Acme', email: 'test@example.com' },
      organization: { name: 'Org', alertSettings: 'invalid json' },
      lineItems: [], issueDate: new Date(), dueDate: new Date()
    });

    const res = await POST(...req());
    expect(res.status).toBe(200);
  });

  it('returns 502 if resend API fails', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'INV-123', total: 1000,
      client: { name: 'Acme', email: 'test@example.com' },
      lineItems: [], issueDate: new Date(), dueDate: new Date()
    });
    mFetch.mockResolvedValue({ ok: false, text: async () => 'Failed' } as any);

    const res = await POST(...req());
    expect(res.status).toBe(502);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(...req());
    expect(res.status).toBe(500);
  });
});
