import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, PUT } from '@/app/api/settings/organization/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/settings/organization', () => {
  function req(method='GET', body?:unknown): NextRequest {
    const init: Record<string,unknown> = { method };
    if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
    return new NextRequest(new URL('http://localhost:3008/api/settings/organization'), init);
  }

  describe('GET', () => {
    it('returns default organization if not found', async () => {
      mp.organization.findFirst.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.organization.currency).toBe('INR');
      expect(data.hasResend).toBeDefined();
    });

    it('returns existing organization', async () => {
      mp.organization.findFirst.mockResolvedValue({ id: 'org-1', name: 'My Org' } as any);
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.organization.name).toBe('My Org');
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('PUT', () => {
    it('updates existing organization', async () => {
      mp.organization.findFirst.mockResolvedValue({ id: 'org-1', name: 'Old Name' } as any);
      mp.organization.update.mockResolvedValue({ id: 'org-1', name: 'New Name' } as any);

      const res = await PUT(req('PUT', { name: 'New Name', alertSettings: { runwayWarningMonths: 6 } }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.organization.name).toBe('New Name');
      expect(mp.organization.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Name',
          alertSettings: JSON.stringify({ runwayWarningMonths: 6 })
        })
      }));
    });

    it('updates existing organization with string alertSettings and cashInBank', async () => {
      mp.organization.findFirst.mockResolvedValue({ id: 'org-1', name: 'Old Name' } as any);
      mp.organization.update.mockResolvedValue({ id: 'org-1', cashInBank: 1000 } as any);

      const res = await PUT(req('PUT', { alertSettings: '{"runwayWarningMonths": 6}', cashInBank: 1000 }));
      expect(res.status).toBe(200);
      expect(mp.organization.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          alertSettings: '{"runwayWarningMonths": 6}',
          cashInBank: 1000
        })
      }));
    });

    it('creates new organization if none exists', async () => {
      mp.organization.findFirst.mockResolvedValue(null);
      mp.organization.create.mockResolvedValue({ id: 'org-2', name: 'New Org' } as any);

      const res = await PUT(req('PUT', { name: 'New Org', gstNumber: 'GST123' }));
      expect(res.status).toBe(200);
      expect(mp.organization.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Org',
          gstNumber: 'GST123',
          users: { connect: { id: 'u1' } }
        })
      }));
    });

    it('creates new organization with default name/currency if omitted', async () => {
      mp.organization.findFirst.mockResolvedValue(null);
      mp.organization.create.mockResolvedValue({ id: 'org-2' } as any);

      const res = await PUT(req('PUT', { }));
      expect(res.status).toBe(200);
      expect(mp.organization.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'My Company',
          currency: 'INR'
        })
      }));
    });
    
    it('creates new organization with string alertSettings', async () => {
      mp.organization.findFirst.mockResolvedValue(null);
      mp.organization.create.mockResolvedValue({ id: 'org-2' } as any);

      const res = await PUT(req('PUT', { alertSettings: '{"test": 1}' }));
      expect(res.status).toBe(200);
      expect(mp.organization.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          alertSettings: '{"test": 1}'
        })
      }));
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await PUT(req('PUT', {}));
      expect(res.status).toBe(500);
    });

    it('creates new organization with object alertSettings', async () => {
      mp.organization.findFirst.mockResolvedValue(null);
      mp.organization.create.mockResolvedValue({ id: 'org-2' } as any);

      const res = await PUT(req('PUT', { alertSettings: { budgetAlertThreshold: 0.5 } }));
      expect(res.status).toBe(200);
      expect(mp.organization.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          alertSettings: JSON.stringify({ budgetAlertThreshold: 0.5 })
        })
      }));
    });

    it('updates with only name, preserving existing org fields', async () => {
      const existing = { id: 'org-1', name: 'Old', gstNumber: 'GST', address: 'Addr', logoUrl: 'logo.png', alertSettings: '{}', cashInBank: 500 };
      mp.organization.findFirst.mockResolvedValue(existing as any);
      mp.organization.update.mockResolvedValue({ ...existing, name: 'Updated' } as any);

      const res = await PUT(req('PUT', { name: 'Updated' }));
      expect(res.status).toBe(200);
      expect(mp.organization.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'Updated',
          gstNumber: 'GST',
          address: 'Addr',
          logoUrl: 'logo.png',
          alertSettings: '{}',
          cashInBank: 500,
        })
      }));
    });
  });
});
