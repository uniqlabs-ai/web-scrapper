import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankAccount: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/guards';
import { prisma } from '@/lib/prisma';
import { GET, POST, PUT, DELETE } from '@/app/api/bank/accounts/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, userId: 'u1', organizationId: 'org-1' } as any);
});

describe('/api/bank/accounts', () => {
  describe('GET', () => {
    it('returns accounts', async () => {
      mp.bankAccount.findMany.mockResolvedValue([{ id: 'acc1', name: 'Test' }] as any);
      const req = new NextRequest(new URL('http://localhost:3008/api/bank/accounts'));
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(1);
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/bank/accounts'), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 on invalid payload', async () => {
      const res = await POST(makeReq({ accountType: 'invalid' }));
      expect(res.status).toBe(400);
    });

    it('creates a new account successfully', async () => {
      mp.bankAccount.create.mockResolvedValue({ id: 'acc2', name: 'HDFC Bank Account' } as any);
      const res = await POST(makeReq({ bankName: 'HDFC', accountNumber: '1234567890' }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe('acc2');
      expect(mp.bankAccount.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ accountLast4: '7890' })
      }));
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await POST(makeReq({ name: 'Test' }));
      expect(res.status).toBe(500);
    });

    it('creates account with empty payload (testing fallbacks)', async () => {
      mp.bankAccount.create.mockResolvedValue({ id: 'acc1' } as any);
      const res = await POST(makeReq({})); // No name, no bankName, no accountNumber
      expect(res.status).toBe(201);
      expect(mp.bankAccount.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'Bank Account',
          bankName: null,
          accountNumber: null,
          accountLast4: null
        })
      }));
    });
  });

  describe('PUT', () => {
    function makeReq(body: any): NextRequest {
      return new NextRequest(new URL('http://localhost:3008/api/bank/accounts'), {
        method: 'PUT',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body)
      });
    }

    it('returns 400 if ID is missing', async () => {
      const res = await PUT(makeReq({ name: 'Test' }));
      expect(res.status).toBe(400);
    });

    it('returns 404 if account not found', async () => {
      mp.bankAccount.findFirst.mockResolvedValue(null);
      const res = await PUT(makeReq({ id: 'acc1', name: 'Test' }));
      expect(res.status).toBe(404);
    });

    it('updates account successfully', async () => {
      mp.bankAccount.findFirst.mockResolvedValue({ id: 'acc1', accountNumber: '123' } as any);
      mp.bankAccount.update.mockResolvedValue({ id: 'acc1', name: 'Updated' } as any);
      
      const res = await PUT(makeReq({ id: 'acc1', name: 'Updated' }));
      expect(res.status).toBe(200);
      expect(mp.bankAccount.update).toHaveBeenCalled();
    });

    it('returns 500 on error', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await PUT(makeReq({ id: 'acc1' }));
      expect(res.status).toBe(500);
    });

    it('updates account with empty payload (testing fallbacks)', async () => {
      mp.bankAccount.findFirst.mockResolvedValue({ id: 'acc1', accountNumber: null, accountLast4: null } as any);
      mp.bankAccount.update.mockResolvedValue({ id: 'acc1' } as any);
      const res = await PUT(makeReq({ id: 'acc1' })); // No accountNumber, no accountLast4
      expect(res.status).toBe(200);
      expect(mp.bankAccount.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          accountLast4: null
        })
      }));
    });
  });

  describe('DELETE', () => {
    it('returns 400 if ID is missing', async () => {
      const req = new NextRequest(new URL('http://localhost:3008/api/bank/accounts'), { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 if account not found', async () => {
      mp.bankAccount.findFirst.mockResolvedValue(null);
      const req = new NextRequest(new URL('http://localhost:3008/api/bank/accounts?id=acc1'), { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(404);
    });

    it('deletes account successfully', async () => {
      mp.bankAccount.findFirst.mockResolvedValue({ id: 'acc1', name: 'Test' } as any);
      const req = new NextRequest(new URL('http://localhost:3008/api/bank/accounts?id=acc1'), { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      expect(mp.bankAccount.delete).toHaveBeenCalled();
    });

    it('returns 500 on error', async () => {
      mg.mockRejectedValue(new Error('Auth failed'));
      const req = new NextRequest(new URL('http://localhost:3008/api/bank/accounts?id=acc1'), { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(500);
    });

    it('returns permission guard response if denied', async () => {
      mg.mockResolvedValue({ allowed: false, response: new Response('Denied', { status: 403 }) } as any);
      const req = new NextRequest(new URL('http://localhost:3008/api/bank/accounts?id=acc1'), { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(403);
    });
  });
});
