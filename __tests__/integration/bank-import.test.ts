import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankAccount: { findFirst: vi.fn(), create: vi.fn() },
    importBatch: { create: vi.fn(), update: vi.fn() },
    bankTransaction: { create: vi.fn(), findMany: vi.fn() },
    expense: { create: vi.fn(), findMany: vi.fn() },
    revenue: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/bank-import', () => ({
  parseCSV: vi.fn(),
  detectColumnMapping: vi.fn(),
  normalizeTransactions: vi.fn(),
  extractVendor: vi.fn().mockReturnValue('TestVendor'),
}));
vi.mock('@/lib/transaction-categorizer', () => ({
  categorizeTransaction: vi.fn(),
  batchCategorize: vi.fn(),
  EXPENSE_CATEGORIES: [],
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { parseCSV, detectColumnMapping, normalizeTransactions } from '@/lib/bank-import';
import { batchCategorize } from '@/lib/transaction-categorizer';
import { POST } from '@/app/api/bank/import/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function makeFormReq(file: File | null, extras?: Record<string, string>): NextRequest {
  const fd = new FormData();
  if (file) fd.append('file', file);
  if (extras) { for (const [k,v] of Object.entries(extras)) fd.append(k,v); }
  return new NextRequest(new URL('http://localhost:3008/api/bank/import'), { method:'POST', body: fd });
}

describe('POST /api/bank/import', () => {
  it('returns 400 when no file uploaded', async () => {
    const res = await POST(makeFormReq(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported file type', async () => {
    const file = new File(['data'], 'test.xlsx', { type: 'application/xlsx' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(400);
  });

  it('returns 400 when CSV has no rows', async () => {
    vi.mocked(parseCSV).mockReturnValue({ headers:['date','desc','amount'], rows:[] });
    const file = new File(['date,desc,amount'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(400);
  });

  it('returns 422 when columns cannot be detected', async () => {
    vi.mocked(parseCSV).mockReturnValue({ headers:['a','b','c'], rows:[['1','2','3']] });
    vi.mocked(detectColumnMapping).mockReturnValue({ date: null, description: null } as any);
    const file = new File(['a,b,c\n1,2,3'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(422);
  });

  it('successfully imports CSV bank transactions', async () => {
    vi.mocked(parseCSV).mockReturnValue({
      headers:['date','description','debit','credit','balance'],
      rows:[['2025-04-01','AWS Payment','15000','','100000']],
    });
    vi.mocked(detectColumnMapping).mockReturnValue({
      date:'date', description:'description', debit:'debit', credit:'credit', balance:'balance', amount:null,
    } as any);
    vi.mocked(normalizeTransactions).mockReturnValue([
      { date:new Date('2025-04-01'), description:'AWS Payment', amount:15000, type:'debit', balance:100000, reference:'', hash:'h1' },
    ]);
    vi.mocked(batchCategorize).mockReturnValue([
      { category:'SaaS', vendor:'AWS', confidence:0.8 },
    ]);

    (mp.bankAccount.findFirst as any).mockResolvedValue({ id:'acct-1' });
    (mp.importBatch.create as any).mockResolvedValue({ id:'batch-1' });
    (mp.expense.findMany as any).mockResolvedValue([]); // no historical expenses
    (mp.user.findUnique as any).mockResolvedValue({ organizationId:'org-1' });
    (mp.bankTransaction.findMany as any).mockResolvedValue([]); // no existing txns
    (mp.bankTransaction.create as any).mockResolvedValue({});
    (mp.expense.create as any).mockResolvedValue({});
    (mp.importBatch.update as any).mockResolvedValue({});

    const file = new File(['date,description,debit,credit,balance\n2025-04-01,AWS,15000,,100000'], 'stmt.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
    expect(d.imported).toBe(1);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const file = new File(['data'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(500);
  });
});
