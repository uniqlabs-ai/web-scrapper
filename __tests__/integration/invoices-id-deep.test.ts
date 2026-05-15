import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { GET, PUT, DELETE } from '@/app/api/invoices/[id]/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, userId: 'u1', organizationId: 'org-1' } as any);
});

describe('/api/invoices/[id]', () => {
  function makeReq(method: string, body?: any): NextRequest {
    return new NextRequest(new URL('http://localhost:3008/api/invoices/inv-1'), {
      method,
      headers: body ? new Headers({ 'content-type': 'application/json' }) : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  }

  describe('GET', () => {
    it('returns 404 if invoice not found', async () => {
      mp.invoice.findFirst.mockResolvedValue(null);
      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(404);
    });

    it('returns invoice details', async () => {
      mp.invoice.findFirst.mockResolvedValue({ id: 'inv-1', invoiceNumber: '001' } as any);
      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.invoice.invoiceNumber).toBe('001');
    });

    it('returns 500 on unexpected exception', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(500);
    });
  });

  describe('PUT', () => {
    it('returns guard response if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await PUT(makeReq('PUT', {}), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(403);
    });

    it('updates invoice correctly', async () => {
      mp.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'paid' } as any);
      const res = await PUT(makeReq('PUT', { status: 'paid', dueDate: new Date().toISOString() }), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(200);
      expect(mp.invoice.update).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exception', async () => {
      mg.mockRejectedValue(new Error('fail'));
      const res = await PUT(makeReq('PUT', {}), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    it('deletes invoice successfully', async () => {
      mp.invoice.findFirst.mockResolvedValue({ id: 'inv-1', invoiceNumber: '001' } as any);
      mp.invoice.delete.mockResolvedValue({ id: 'inv-1' } as any);

      const res = await DELETE(makeReq('DELETE'), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(200);
      expect(mp.invoice.delete).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exception', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await DELETE(makeReq('DELETE'), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(500);
    });
  });
});
