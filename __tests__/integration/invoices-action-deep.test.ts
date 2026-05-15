import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/invoices/[id]/[action]/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function makeReq(action: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3008/api/invoices/inv-1/${action}`), { method: 'POST' });
}

describe('POST /api/invoices/[id]/[action]', () => {
  it('returns 404 if invoice not found', async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
    const res = await POST(makeReq('send'), { params: Promise.resolve({ id: 'inv-1', action: 'send' }) });
    expect(res.status).toBe(404);
  });

  describe('send action', () => {
    it('returns 400 if invoice is not draft', async () => {
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 'inv-1', status: 'sent' } as any);
      const res = await POST(makeReq('send'), { params: Promise.resolve({ id: 'inv-1', action: 'send' }) });
      expect(res.status).toBe(400);
    });

    it('updates invoice to sent', async () => {
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 'inv-1', status: 'draft' } as any);
      vi.mocked(prisma.invoice.update).mockResolvedValue({ id: 'inv-1', status: 'sent' } as any);
      const res = await POST(makeReq('send'), { params: Promise.resolve({ id: 'inv-1', action: 'send' }) });
      expect(res.status).toBe(200);
      expect(prisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'sent' })
      }));
    });
  });

  describe('paid action', () => {
    it('returns 400 if invoice is not sent or overdue', async () => {
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 'inv-1', status: 'draft' } as any);
      const res = await POST(makeReq('paid'), { params: Promise.resolve({ id: 'inv-1', action: 'paid' }) });
      expect(res.status).toBe(400);
    });

    it('updates invoice to paid', async () => {
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 'inv-1', status: 'sent' } as any);
      vi.mocked(prisma.invoice.update).mockResolvedValue({ id: 'inv-1', status: 'paid' } as any);
      const res = await POST(makeReq('paid'), { params: Promise.resolve({ id: 'inv-1', action: 'paid' }) });
      expect(res.status).toBe(200);
      expect(prisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'paid' })
      }));
    });
  });

  it('returns 400 on unknown action', async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 'inv-1', status: 'draft' } as any);
    const res = await POST(makeReq('unknown'), { params: Promise.resolve({ id: 'inv-1', action: 'unknown' }) });
    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq('send'), { params: Promise.resolve({ id: 'inv-1', action: 'send' }) });
    expect(res.status).toBe(500);
  });
});
