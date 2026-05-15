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

  it('syncs transactions from multipart Gmail messages (HTML fallback) and matches by bank domain', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-2', accountLast4:null, bankName:'Unknown', bankEmailDomains:'hdfcbank.net', name:'HDFC' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});
    (mp.bankTransaction.findFirst as any).mockResolvedValue(null);
    (mp.bankTransaction.create as any).mockResolvedValue({});

    vi.mocked(isBankAlert).mockReturnValue(true);
    vi.mocked(parseBankEmail).mockReturnValue({
      amount: 5000, type: 'credit', description: 'HDFC Credit',
      date: new Date('2025-04-15'), accountLast4: undefined, bank: undefined,
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-2' }] }) }) // message list
      .mockResolvedValueOnce({ json: async () => ({ // message details
        payload: {
          headers: [
            { name: 'Subject', value: 'Credit Alert' },
            { name: 'From', value: 'alerts@hdfcbank.net' },
            { name: 'Date', value: '2025-04-15' },
          ],
          parts: [
            { mimeType: 'image/png' },
            { mimeType: 'text/html', body: { data: Buffer.from('<b>INR 5,000 credited</b>').toString('base64') } }
          ]
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.synced).toBe(1);
  });

  it('syncs transactions from multipart Gmail messages (Text) and matches by fuzzy bank name', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-3', accountLast4:null, bankName:'SBI Bank', bankEmailDomains:'sbi.co.in', name:'SBI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});
    (mp.bankTransaction.findFirst as any).mockResolvedValue(null);
    (mp.bankTransaction.create as any).mockResolvedValue({});

    vi.mocked(isBankAlert).mockReturnValue(true);
    vi.mocked(parseBankEmail).mockReturnValue({
      amount: 1000, type: 'debit', description: 'SBI Debit',
      date: new Date('2025-04-15'), accountLast4: undefined, bank: 'SBI Bank',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-3' }] }) })
      .mockResolvedValueOnce({ json: async () => ({
        payload: {
          headers: [
            { name: 'Subject', value: 'Debit Alert' },
            { name: 'From', value: 'alerts@sbi.co.in' },
            { name: 'Date', value: '2025-04-15' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from('INR 1,000 debited').toString('base64') } }
          ]
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.synced).toBe(1);
  });

  it('skips duplicate transaction and handles decode body failure', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-4', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});
    (mp.bankTransaction.findFirst as any).mockResolvedValue({ id: 'existing' }); // duplicate

    vi.mocked(isBankAlert).mockReturnValue(true);
    vi.mocked(parseBankEmail).mockReturnValue({
      amount: 1000, type: 'debit', description: 'SBI Debit',
      date: new Date('2025-04-15'), accountLast4: '1234', bank: 'ICICI',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-3' }] }) })
      .mockResolvedValueOnce({ json: async () => ({
        payload: {
          headers: [
            { name: 'From', value: 'alerts@icicibank.com' }
          ],
          // Invalid payload to trigger try/catch or empty body
          body: { data: 123 as any }
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.synced).toBe(0);
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

  it('skips non-bank alert emails', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});

    vi.mocked(isBankAlert).mockReturnValue(false); // not a bank alert

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-1' }] }) })
      .mockResolvedValueOnce({ json: async () => ({
        payload: {
          headers: [
            { name: 'Subject', value: 'Newsletter' },
            { name: 'From', value: 'news@example.com' },
          ],
          body: { data: Buffer.from('Hello').toString('base64') },
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(d.synced).toBe(0);
  });

  it('skips when parseBankEmail returns null', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});

    vi.mocked(isBankAlert).mockReturnValue(true);
    vi.mocked(parseBankEmail).mockReturnValue(null as any); // unparseable

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-1' }] }) })
      .mockResolvedValueOnce({ json: async () => ({
        payload: {
          headers: [
            { name: 'Subject', value: 'Alert' },
            { name: 'From', value: 'alerts@icicibank.com' },
            { name: 'Date', value: '2025-04-15' },
          ],
          body: { data: Buffer.from('Something').toString('base64') },
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(d.synced).toBe(0);
  });

  it('skips when matchToAccount returns null', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'9999', bankName:'SBI', bankEmailDomains:'icicibank.com', name:'SBI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});

    vi.mocked(isBankAlert).mockReturnValue(true);
    vi.mocked(parseBankEmail).mockReturnValue({
      amount: 1000, type: 'debit', description: 'Test',
      date: new Date(), accountLast4: '5555', bank: 'Unknown Bank',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-1' }] }) })
      .mockResolvedValueOnce({ json: async () => ({
        payload: {
          headers: [
            { name: 'Subject', value: 'Alert' },
            { name: 'From', value: 'noreply@randombank.com' },
            { name: 'Date', value: '2025-04-15' },
          ],
          body: { data: Buffer.from('Debit').toString('base64') },
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(d.skipped).toBe(1);
  });

  it('handles message-level errors in the loop', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-1' }] }) })
      .mockResolvedValueOnce({ json: async () => { throw new Error('network fail'); } });

    const res = await POST();
    const d = await res.json();
    expect(d.errors).toBeDefined();
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it('creates transaction without reference (uses GMAIL prefix)', async () => {
    (mp.integration.findFirst as any).mockResolvedValue({ id:'int-1', accessToken:'token', refreshToken:null });
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { id:'acct-1', accountLast4:'1234', bankName:'ICICI', bankEmailDomains:'icicibank.com', name:'ICICI' },
    ]);
    (mp.integration.update as any).mockResolvedValue({});
    (mp.bankTransaction.findFirst as any).mockResolvedValue(null);
    (mp.bankTransaction.create as any).mockResolvedValue({});

    vi.mocked(isBankAlert).mockReturnValue(true);
    vi.mocked(parseBankEmail).mockReturnValue({
      amount: 3000, type: 'debit', description: 'Test',
      date: new Date(), accountLast4: '1234', bank: 'ICICI',
      // no reference field
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ messages: [{ id: 'msg-abc12345' }] }) })
      .mockResolvedValueOnce({ json: async () => ({
        payload: {
          headers: [
            { name: 'Subject', value: 'Debit' },
            { name: 'From', value: 'alerts@icicibank.com' },
            { name: 'Date', value: '2025-04-15' },
          ],
          body: { data: Buffer.from('Debited').toString('base64') },
        },
      })});

    const res = await POST();
    const d = await res.json();
    expect(d.synced).toBe(1);
  });
});

