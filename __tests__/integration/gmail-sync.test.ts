import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    integration: { findFirst: vi.fn(), update: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    bankTransaction: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/gmail-parser', () => ({
  parseBankEmail: vi.fn(),
  isBankAlert: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { parseBankEmail, isBankAlert } from '@/lib/gmail-parser';
import { POST } from '@/app/api/integrations/gmail/sync/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

const origFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});
afterEach(() => { global.fetch = origFetch; });

describe('POST /api/integrations/gmail/sync', () => {
  it('returns 400 when Gmail is not connected', async () => {
    (mp.integration.findFirst as any).mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(400);
  });

  it('returns 0 synced when no bank accounts exist', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null, status:'connected' });
    (mp.bankAccount.findMany as any).mockResolvedValue([]);
    const res = await POST();
    const d = await res.json();
    expect(d.synced).toBe(0);
    expect(d.message).toContain('No bank accounts');
  });

  it('returns 0 synced when no bank email domains configured', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:null, name:'ICICI' },
    ]);
    const res = await POST();
    const d = await res.json();
    expect(d.synced).toBe(0);
    expect(d.message).toContain('No email domains');
  });

  it('syncs transactions from Gmail messages', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:'refresh' });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});
    (mp.bankTransaction.findFirst as any).mockResolvedValue(null); // no duplicate
    (mp.bankTransaction.create as any).mockResolvedValue({});

    vi.mocked(isBankAlert).mockReturnValue(true);
    vi.mocked(parseBankEmail).mockReturnValue({
      amount: 15000, type: 'debit', description: 'AWS Payment',
      date: new Date('2025-04-15'), accountLast4: '1234', bank: 'ICICI',
    });

    // Mock fetch for OAuth refresh + Gmail API
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ access_token: 'new-token' }) }) // OAuth refresh
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-1' }] }) }) // message list
      .mockResolvedValueOnce({ json: async () => ({ // message details
        payload: {
          headers: [
            { name: 'Subject', value: 'Debit Alert' },
            { name: 'From', value: 'alerts@icicibank.com' },
            { name: 'Date', value: '2025-04-15' },
          ],
          body: { data: Buffer.from('INR 15,000 debited from A/C XX1234').toString('base64') },
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.synced).toBe(1);
  });

  it('returns 401 when access token is null', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:null, refreshToken:'refresh' });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({ json: async () => ({}) }); // No access_token returned

    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('handles 0 messages from Gmail', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});

    global.fetch = vi.fn().mockResolvedValueOnce({ json: async () => ({ messages: [] }) });

    const res = await POST();
    const d = await res.json();
    expect(d.synced).toBe(0);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
