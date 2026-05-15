import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequirePermission = vi.fn();
vi.mock('@/lib/guards', () => ({ requirePermission: (...args: any[]) => mockRequirePermission(...args) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankAccount: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bankTransaction: { deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST, PUT, DELETE } from '@/app/api/bank/accounts/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue({ allowed: true });
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/bank/accounts'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/bank/accounts', () => {
  it('returns accounts list', async () => {
    (mp.bankAccount.findMany as any).mockResolvedValue([{ id: 'acc1', _count: { transactions: 5 } }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data[0].id).toBe('acc1');
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/bank/accounts', () => {
  it('returns 400 on invalid payload', async () => {
    const res = await POST(req('POST', { accountType: 'invalid-type' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid payload');
  });

  it('creates account and extracts last 4 digits', async () => {
    (mp.bankAccount.create as any).mockResolvedValue({ id: 'acc1' });
    const res = await POST(req('POST', {
      bankName: 'HDFC',
      accountNumber: '1234567890123',
    }));
    expect(res.status).toBe(201);
    expect(mp.bankAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountLast4: '0123',
        name: 'HDFC Account',
        accountType: 'savings'
      })
    }));
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST', { name: 'Test' }));
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/bank/accounts', () => {
  it('returns 400 if id is missing', async () => {
    const res = await PUT(req('PUT', { name: 'New Name' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 if account not found', async () => {
    (mp.bankAccount.findFirst as any).mockResolvedValue(null);
    const res = await PUT(req('PUT', { id: 'missing' }));
    expect(res.status).toBe(404);
  });

  it('updates account and extracts last 4 digits if account number changes', async () => {
    (mp.bankAccount.findFirst as any).mockResolvedValue({ id: 'acc1', accountNumber: '0000', accountLast4: '0000' });
    (mp.bankAccount.update as any).mockResolvedValue({ id: 'acc1' });
    
    const res = await PUT(req('PUT', { id: 'acc1', accountNumber: '99991111', bankEmailDomains: 'hdfc.com' }));
    expect(res.status).toBe(200);
    expect(mp.bankAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountNumber: '99991111',
        accountLast4: '1111',
        bankEmailDomains: 'hdfc.com'
      })
    }));
  });

  it('updates account with empty fields and explicit accountLast4', async () => {
    (mp.bankAccount.findFirst as any).mockResolvedValue({ id: 'acc1', accountNumber: '0000', accountLast4: '0000' });
    (mp.bankAccount.update as any).mockResolvedValue({ id: 'acc1' });
    
    const res = await PUT(req('PUT', { 
      id: 'acc1', 
      name: ' ', 
      bankName: ' ', 
      accountNumber: ' ', 
      accountLast4: ' 4321 ', 
      accountType: 'current',
      ifscCode: ' ',
      bankEmailDomains: ' ',
      currentBalance: 500,
      isActive: false
    }));
    expect(res.status).toBe(200);
    expect(mp.bankAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bankName: null,
        accountNumber: '',
        accountLast4: '4321',
        ifscCode: null,
        bankEmailDomains: null,
        accountType: 'current',
        currentBalance: 500,
        isActive: false
      })
    }));
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await PUT(req('PUT', { id: 'acc1' }));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/bank/accounts', () => {
  it('returns 403 if permission denied', async () => {
    mockRequirePermission.mockResolvedValue({ allowed: false, response: new Response('Forbidden', { status: 403 }) });
    const res = await DELETE(req('DELETE', undefined, 'http://localhost:3008/api/bank/accounts?id=acc1'));
    expect(res.status).toBe(403);
  });

  it('returns 400 if id is missing', async () => {
    const res = await DELETE(req('DELETE', undefined, 'http://localhost:3008/api/bank/accounts'));
    expect(res.status).toBe(400);
  });

  it('returns 404 if account not found', async () => {
    (mp.bankAccount.findFirst as any).mockResolvedValue(null);
    const res = await DELETE(req('DELETE', undefined, 'http://localhost:3008/api/bank/accounts?id=acc1'));
    expect(res.status).toBe(404);
  });

  it('deletes account successfully', async () => {
    (mp.bankAccount.findFirst as any).mockResolvedValue({ id: 'acc1', name: 'Test' });
    (mp.bankAccount.delete as any).mockResolvedValue({ id: 'acc1' });
    
    const res = await DELETE(req('DELETE', undefined, 'http://localhost:3008/api/bank/accounts?id=acc1'));
    expect(res.status).toBe(200);
    expect(mp.bankAccount.delete).toHaveBeenCalledWith({ where: { id: 'acc1' } });
  });

  it('handles tenant error', async () => {
    mockRequirePermission.mockRejectedValue(new Error('fail'));
    const res = await DELETE(req('DELETE', undefined, 'http://localhost:3008/api/bank/accounts?id=acc1'));
    expect(res.status).toBe(500);
  });
});
