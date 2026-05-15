import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/accounting/chart/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method='GET', url='http://localhost:3008/api/accounting/chart', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/accounting/chart', () => {
  it('returns chart of accounts with group counts', async () => {
    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.accounts).toBeDefined();
    expect(d.accounts.length).toBeGreaterThan(10);
    expect(d.groups.assets).toBeGreaterThan(0);
    expect(d.groups.liabilities).toBeGreaterThan(0);
  });

  it('returns balance sheet view', async () => {
    const res = await GET(req('GET','http://localhost:3008/api/accounting/chart?view=balance-sheet'));
    const d = await res.json();
    expect(d.balanceSheet).toBeDefined();
    expect(d.balanceSheet.assets).toBeDefined();
    expect(d.balanceSheet.liabilities).toBeDefined();
    expect(d.balanceSheet.equity).toBeDefined();
    expect(d.balanceSheet.isBalanced).toBe(true);
  });

  it('returns journal entries view', async () => {
    const res = await GET(req('GET','http://localhost:3008/api/accounting/chart?view=journal'));
    const d = await res.json();
    expect(d.entries).toBeDefined();
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/accounting/chart', () => {
  it('creates a balanced journal entry and tests GET views', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/accounting/chart',{
      date: '2025-04-01',
      narration: 'Loan',
      entries: [
        { accountCode: '1000', debit: 100000, credit: 0 },
        { accountCode: '3000', debit: 0, credit: 100000 },
      ],
    }));
    expect(res.status).toBe(201);
    const d = await res.json();
    expect(d.id).toMatch(/^JE-/);
    
    await POST(req('POST','http://localhost:3008/api/accounting/chart',{
      date: '2025-04-02',
      narration: 'Pay Loan',
      entries: [
        { accountCode: '3000', debit: 50000, credit: 0 },
        { accountCode: '1000', debit: 0, credit: 50000 },
      ],
    }));

    // Now test GET with the entries populated
    const getRes = await GET(req('GET','http://localhost:3008/api/accounting/chart?view=balance-sheet'));
    const getD = await getRes.json();
    expect(getD.balanceSheet.isBalanced).toBe(true);

    const getRes2 = await GET(req('GET','http://localhost:3008/api/accounting/chart?view=journal'));
    const getD2 = await getRes2.json();
    expect(getD2.entries.length).toBeGreaterThan(0);
  });

  it('rejects unbalanced journal entry', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/accounting/chart',{
      entries: [
        { accountCode: '1000', debit: 100000, credit: 0 },
        { accountCode: '6000', debit: 0, credit: 50000 },
      ],
    }));
    expect(res.status).toBe(400);
  });

  it('rejects entry with fewer than 2 legs', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/accounting/chart',{
      entries: [{ accountCode: '1000', debit: 100000, credit: 0 }],
    }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST','http://localhost:3008/api/accounting/chart',{
      entries: [{ accountCode: '1000', debit: 100, credit: 0 }, { accountCode: '6000', debit: 0, credit: 100 }],
    }));
    expect(res.status).toBe(500);
  });
});
