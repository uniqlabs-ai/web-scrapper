import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    client: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { GET, PUT, DELETE } from '@/app/api/clients/[id]/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, userId: 'u1', organizationId: 'org-1' } as any);
});

describe('/api/clients/[id]', () => {
  function req(method='GET', body?:unknown, id: string='test-id'): [NextRequest, { params: Promise<{id:string}> }] {
    const init: Record<string,unknown> = { method };
    if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
    return [new NextRequest(new URL('http://localhost:3008/api/clients/[id]'), init), { params: Promise.resolve({ id }) }];
  }

  describe('GET', () => {
    it('returns 404 if client not found', async () => {
      mp.client.findFirst.mockResolvedValue(null);
      const res = await GET(...req());
      expect(res.status).toBe(404);
    });

    it('returns client details with aggregated revenues and invoices', async () => {
      mp.client.findFirst.mockResolvedValue({
        id: 'c1',
        invoices: [
          { id: 'i1', total: 1000, issueDate: '2024-01-15T00:00:00Z', status: 'paid', currency: 'USD' },
          { id: 'i2', total: 500, issueDate: '2024-02-10T00:00:00Z', status: 'sent', currency: 'USD' },
          { id: 'i3', total: 200, issueDate: '2024-02-15T00:00:00Z', status: 'draft', currency: 'USD' }
        ],
        revenues: [
          { id: 'r1', amount: 2000, month: '2024-01-01T00:00:00Z', type: 'recurring', source: 'Stripe' },
          { id: 'r2', amount: 1500, month: '2024-03-01T00:00:00Z', type: 'one-time', source: 'Wire' }
        ]
      } as any);

      const res = await GET(...req());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalInvoiced).toBe(1700);
      expect(data.totalRevenue).toBe(3500);
      expect(data.monthlyRevenue.length).toBe(3); // Jan, Feb, Mar
      expect(data.statusBreakdown.length).toBe(3); // Paid, Sent, Draft
      expect(data.transactions.length).toBe(5);
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET(...req());
      expect(res.status).toBe(500);
    });
  });

  describe('PUT', () => {
    it('returns 403 if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await PUT(...req('PUT', {}));
      expect(res.status).toBe(403);
    });

    it('returns 400 if no valid fields provided', async () => {
      const res = await PUT(...req('PUT', { unknownField: 'test' }));
      expect(res.status).toBe(400);
    });

    it('updates client correctly', async () => {
      mp.client.update.mockResolvedValue({ id: 'c1', name: 'Updated' } as any);
      const res = await PUT(...req('PUT', { name: 'Updated', email: 'test@test.com' }));
      expect(res.status).toBe(200);
      expect(mp.client.update).toHaveBeenCalled();
    });

    it('handles unexpected exceptions', async () => {
      mg.mockRejectedValue(new Error('fail'));
      const res = await PUT(...req('PUT', { name: 'Updated' }));
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE', () => {
    it('returns 403 if permission denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const res = await DELETE(...req('DELETE'));
      expect(res.status).toBe(403);
    });

    it('returns 404 if client not found', async () => {
      mp.client.findFirst.mockResolvedValue(null);
      const res = await DELETE(...req('DELETE'));
      expect(res.status).toBe(404);
    });

    it('deletes client successfully', async () => {
      mp.client.findFirst.mockResolvedValue({ id: 'c1' } as any);
      mp.client.delete.mockResolvedValue({ id: 'c1' } as any);
      const res = await DELETE(...req('DELETE'));
      expect(res.status).toBe(200);
      expect(mp.client.delete).toHaveBeenCalled();
    });

    it('handles unexpected exceptions', async () => {
      mg.mockRejectedValue(new Error('fail'));
      const res = await DELETE(...req('DELETE'));
      expect(res.status).toBe(500);
    });
  });
});
