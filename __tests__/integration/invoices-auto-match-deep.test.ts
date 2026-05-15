import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn(), update: vi.fn() },
    bankTransaction: { findMany: vi.fn(), update: vi.fn() },
    client: { findUnique: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/invoices/auto-match/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/invoices/auto-match', () => {
  describe('GET', () => {
    it('returns empty suggestions if no unpaid invoices', async () => {
      mp.invoice.findMany.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.suggestions.length).toBe(0);
    });

    it('matches invoice with exact amount and client name', async () => {
      mp.invoice.findMany.mockResolvedValue([{ id: 'inv-1', invoiceNumber: '001', total: 1000, client: { name: 'Acme', company: 'Acme Corp' }, clientId: 'c1' }] as any);
      mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 1000, description: 'Acme Corp Payment', date: new Date() }] as any);
      mp.client.findUnique.mockResolvedValue({ aliases: ['acmecorp'] } as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.suggestions.length).toBe(1);
      expect(data.suggestions[0].confidence).toBe(0.95);
      expect(data.suggestions[0].matchReason).toContain('Exact amount + client name match');
    });

    it('matches invoice with fuzzy amount and client name', async () => {
      mp.invoice.findMany.mockResolvedValue([{ id: 'inv-1', invoiceNumber: '001', total: 1000, client: { name: 'Acme' }, clientId: 'c1' }] as any);
      mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 980, description: 'Acme Payment', date: new Date() }] as any);
      mp.client.findUnique.mockResolvedValue({ aliases: [] } as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.suggestions.length).toBe(1);
      expect(data.suggestions[0].confidence).toBe(0.85);
      expect(data.suggestions[0].matchReason).toContain('Amount (~5%) + client name match');
    });

    it('matches invoice with exact amount but no name', async () => {
      mp.invoice.findMany.mockResolvedValue([{ id: 'inv-1', invoiceNumber: '001', total: 1000, client: null }] as any);
      mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 1000, description: 'Bank Transfer', date: new Date() }] as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.suggestions.length).toBe(1);
      expect(data.suggestions[0].confidence).toBe(0.65);
      expect(data.suggestions[0].matchReason).toContain('Exact amount match (no name match)');
    });

    it('matches invoice with fuzzy amount only', async () => {
      mp.invoice.findMany.mockResolvedValue([{ id: 'inv-1', invoiceNumber: '001', total: 1000, client: null }] as any);
      mp.bankTransaction.findMany.mockResolvedValue([{ id: 'tx-1', amount: 980, description: 'Bank Transfer', date: new Date() }] as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.suggestions.length).toBe(1);
      expect(data.suggestions[0].confidence).toBe(0.45);
      expect(data.suggestions[0].matchReason).toContain('Approximate amount match');
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/invoices/auto-match'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 if invoiceId or transactionId missing', async () => {
      const res = await POST(makeReq({ invoiceId: 'inv-1' }));
      expect(res.status).toBe(400);
    });

    it('updates invoice and transaction on match confirmation', async () => {
      mp.invoice.update.mockResolvedValue({} as any);
      mp.bankTransaction.update.mockResolvedValue({} as any);

      const res = await POST(makeReq({ invoiceId: 'inv-1', transactionId: 'tx-1' }));
      expect(res.status).toBe(200);
      expect(mp.invoice.update).toHaveBeenCalled();
      expect(mp.bankTransaction.update).toHaveBeenCalled();
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await POST(makeReq({ invoiceId: 'inv-1', transactionId: 'tx-1' }));
      expect(res.status).toBe(500);
    });
  });
});
