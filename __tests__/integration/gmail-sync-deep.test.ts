import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    integration: { findFirst: vi.fn(), update: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    bankTransaction: { findFirst: vi.fn(), create: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

const mockParseBankEmail = vi.fn();
const mockIsBankAlert = vi.fn();
vi.mock('@/lib/gmail-parser', () => ({
  parseBankEmail: (...args) => mockParseBankEmail(...args),
  isBankAlert: (...args) => mockIsBankAlert(...args)
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/integrations/gmail/sync/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mockFetch.mockReset();
});

describe('POST /api/integrations/gmail/sync', () => {
  it('returns 400 if gmail not connected', async () => {
    mp.integration.findFirst.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(400);
  });

  it('returns 200 with 0 synced if no bank accounts registered', async () => {
    mp.integration.findFirst.mockResolvedValue({ id: 'int-1' } as any);
    mp.bankAccount.findMany.mockResolvedValue([]);
    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.synced).toBe(0);
    expect(data.message).toContain('No bank accounts registered');
  });

  it('returns 200 with 0 synced if no email domains configured', async () => {
    mp.integration.findFirst.mockResolvedValue({ id: 'int-1' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ id: 'acc-1', bankEmailDomains: null }] as any);
    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.synced).toBe(0);
    expect(data.message).toContain('No email domains configured');
  });

  it('returns 401 if token expired and refresh fails', async () => {
    mp.integration.findFirst.mockResolvedValue({ id: 'int-1', accessToken: null, refreshToken: 'rt' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ id: 'acc-1', bankEmailDomains: 'test.com' }] as any);
    mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({}) } as any); // Refresh token fails

    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('syncs transactions successfully', async () => {
    mp.integration.findFirst.mockResolvedValue({ id: 'int-1', accessToken: 'at' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ id: 'acc-1', accountLast4: '1234', bankEmailDomains: 'test.com' }] as any);
    
    // list messages
    mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ messages: [{ id: 'msg-1' }] }) } as any);
    
    // get message
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        payload: {
          headers: [
            { name: 'Subject', value: 'Alert' },
            { name: 'From', value: 'test@test.com' },
            { name: 'Date', value: new Date().toISOString() }
          ],
          parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('test').toString('base64') } }]
        }
      })
    } as any);

    mockIsBankAlert.mockReturnValue(true);
    mockParseBankEmail.mockReturnValue({ accountLast4: '1234', bank: 'Test Bank', amount: 100, type: 'debit', date: new Date() });
    mp.bankTransaction.findFirst.mockResolvedValue(null);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.synced).toBe(1);
    expect(mp.bankTransaction.create).toHaveBeenCalled();
  });

  it('skips duplicate transaction', async () => {
    mp.integration.findFirst.mockResolvedValue({ id: 'int-1', accessToken: 'at' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ id: 'acc-1', accountLast4: '1234', bankEmailDomains: 'test.com' }] as any);
    mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ messages: [{ id: 'msg-1' }] }) } as any);
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        payload: { headers: [], body: { data: Buffer.from('test').toString('base64') } }
      })
    } as any);

    mockIsBankAlert.mockReturnValue(true);
    mockParseBankEmail.mockReturnValue({ accountLast4: '1234', bank: 'Test Bank', amount: 100, type: 'debit', date: new Date() });
    mp.bankTransaction.findFirst.mockResolvedValue({ id: 'tx-1' } as any);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.synced).toBe(0);
    expect(data.skipped).toBe(1);
  });

  it('extracts html body correctly and skips unmatched accounts', async () => {
    mp.integration.findFirst.mockResolvedValue({ id: 'int-1', accessToken: 'at' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ id: 'acc-1', accountLast4: '1234', bankEmailDomains: 'test.com' }] as any);
    
    // list messages
    mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ messages: [{ id: 'msg-1' }, { id: 'msg-2' }] }) } as any);
    
    // get message 1 (HTML part)
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        payload: {
          headers: [{ name: 'Subject', value: 'Alert' }, { name: 'From', value: 'test@test.com' }, { name: 'Date', value: new Date().toISOString() }],
          parts: [{ mimeType: 'text/html', body: { data: Buffer.from('<html>test</html>').toString('base64') } }]
        }
      })
    } as any);

    // get message 2 (Fetch error)
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.reject(new Error('Network error'))
    } as any);

    mockIsBankAlert.mockReturnValue(true);
    mockParseBankEmail.mockReturnValue({ accountLast4: '9999', bank: 'Other Bank', amount: 100, type: 'debit', date: new Date() }); // Unmatched account

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.synced).toBe(0);
    expect(data.skipped).toBe(1);
    expect(data.errors.length).toBe(1);
    expect(data.errors[0]).toContain('Network error');
  });

  it('skips non-bank alerts', async () => {
    mp.integration.findFirst.mockResolvedValue({ id: 'int-1', accessToken: 'at' } as any);
    mp.bankAccount.findMany.mockResolvedValue([{ id: 'acc-1', accountLast4: '1234', bankEmailDomains: 'test.com' }] as any);
    mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ messages: [{ id: 'msg-1' }] }) } as any);
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ payload: { headers: [] } })
    } as any);

    mockIsBankAlert.mockReturnValue(false);

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.synced).toBe(0);
    expect(data.skipped).toBe(0);
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
