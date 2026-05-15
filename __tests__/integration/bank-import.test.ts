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
  findOrCreateBankAccount: vi.fn().mockResolvedValue('acct-1'),
  checkExistingHashes: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock('@/lib/transaction-categorizer', () => ({
  categorizeTransaction: vi.fn(),
  batchCategorize: vi.fn(),
  EXPENSE_CATEGORIES: [],
}));
vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({ writeFileSync: vi.fn(), readFileSync: vi.fn(), unlinkSync: vi.fn(), existsSync: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { parseCSV, detectColumnMapping, normalizeTransactions, findOrCreateBankAccount } from '@/lib/bank-import';
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

  it('returns 422 when no amount column is detected', async () => {
    vi.mocked(parseCSV).mockReturnValue({ headers:['date','description'], rows:[['2025-04-01','AWS']] });
    vi.mocked(detectColumnMapping).mockReturnValue({ date:'date', description:'description', amount:null, debit:null, credit:null } as any);
    const file = new File(['date,description\n2025-04-01,AWS'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(422);
  });

  it('auto-creates bank account if none exists and processes credit transactions', async () => {
    vi.mocked(parseCSV).mockReturnValue({
      headers:['date','description','credit'],
      rows:[['2025-04-01','Stripe','15000']],
    });
    vi.mocked(detectColumnMapping).mockReturnValue({
      date:'date', description:'description', credit:'credit', amount:null, debit:null,
    } as any);
    vi.mocked(normalizeTransactions).mockReturnValue([
      { date:new Date('2025-04-01'), description:'Stripe', amount:15000, type:'credit', reference:'', hash:'h2' },
      { date:new Date('2025-04-02'), description:'Duplicate', amount:1000, type:'debit', reference:'', hash:'h3' },
      { date:new Date('2025-04-03'), description:'TRF TO FD', amount:5000, type:'debit', reference:'', hash:'h4' }, // internal transfer
      { date:new Date('2025-04-04'), description:'Small fee', amount:0.5, type:'debit', reference:'', hash:'h5' }, // trivial amount
    ]);
    vi.mocked(batchCategorize).mockReturnValue([
      { category:'Capital', vendor:'Stripe', confidence:0.8 }, // Capital -> capital revenue
      { category:'SaaS', vendor:'AWS', confidence:0.9 },
      { category:'Transfer', vendor:null, confidence:0.9 },
      { category:'Fee', vendor:null, confidence:0.9 },
    ]);

    // findOrCreateBankAccount is mocked at module level to return 'acct-1'
    (mp.bankTransaction.findMany as any).mockResolvedValue([{ hash: 'h3' }]); // 'Duplicate' already exists
    (mp.importBatch.create as any).mockResolvedValue({ id:'batch-1' });

    const file = new File(['date,description,credit\n2025-04-01,Stripe,15000'], 'stmt.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.imported).toBe(3); // 3 imported, 1 skipped (h3 dedup'd by fuzzy match)
    expect(findOrCreateBankAccount).toHaveBeenCalled();
    expect(mp.revenue.create).toHaveBeenCalled();
  });

  it('handles db errors during transaction creation and ignores expense/revenue create errors', async () => {
    vi.mocked(parseCSV).mockReturnValue({
      headers:['date','description','debit'],
      rows:[['2025-04-01','Test','15000']],
    });
    vi.mocked(detectColumnMapping).mockReturnValue({
      date:'date', description:'description', debit:'debit', amount:null, credit:null,
    } as any);
    vi.mocked(normalizeTransactions).mockReturnValue([
      { date:new Date('2025-04-01'), description:'FailTxn', amount:100, type:'debit', reference:'', hash:'h_fail' },
      { date:new Date('2025-04-02'), description:'FailExp', amount:100, type:'debit', reference:'', hash:'h_exp' },
      { date:new Date('2025-04-03'), description:'FailRev', amount:100, type:'credit', reference:'', hash:'h_rev' },
    ]);
    vi.mocked(batchCategorize).mockReturnValue([
      { category:'SaaS', vendor:'AWS', confidence:0.9 },
      { category:'SaaS', vendor:'AWS', confidence:0.9 },
      { category:'Income', vendor:'Stripe', confidence:0.9 },
    ]);

    (mp.bankAccount.findFirst as any).mockResolvedValue({ id:'acct-1' });
    (mp.bankTransaction.findMany as any).mockResolvedValue([]);
    (mp.importBatch.create as any).mockResolvedValue({ id:'batch-1' });
    
    // 1st throws unknown error, 2nd succeeds txn but fails expense, 3rd succeeds txn but fails revenue
    (mp.bankTransaction.create as any)
      .mockRejectedValueOnce(new Error('Unknown DB error'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    (mp.expense.create as any).mockRejectedValueOnce(new Error('Exp error'));
    (mp.revenue.create as any).mockRejectedValueOnce(new Error('Rev error'));

    const file = new File(['data'], 'stmt.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.imported).toBe(2);
  });

  it('processes PDF uploads successfully and handles cleanup errors safely', async () => {
    const fs = await import('fs');
    const cp = await import('child_process');
    
    vi.mocked(cp.execSync).mockReturnValue(JSON.stringify({
      success: true,
      transaction_count: 1,
    }));
    vi.mocked(fs.readFileSync).mockReturnValue('date,desc,amount\n2025-01-01,Test,100');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('Unlink fail'); }); // testing cleanup throw

    vi.mocked(parseCSV).mockReturnValue({ headers:['date','desc','amount'], rows:[['2025-01-01','Test','100']] });
    vi.mocked(detectColumnMapping).mockReturnValue({ date:'date', description:'desc', amount:'amount' } as any);
    vi.mocked(normalizeTransactions).mockReturnValue([{ date:new Date(), description:'Test', amount:100, type:'debit', hash:'h4' }]);
    vi.mocked(batchCategorize).mockReturnValue([{ category:'Misc', vendor:'Test', confidence:0.5 }]);

    const file = new File(['dummy-pdf-content'], 'test.pdf', { type: 'application/pdf' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(200);
  });

  it('returns 422 when PDF extraction fails with error thrown', async () => {
    const cp = await import('child_process');
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('PDF Error'); });

    const file = new File(['dummy-pdf-content'], 'test.pdf', { type: 'application/pdf' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(422);
  });

  it('returns 422 when PDF extraction metadata success is false', async () => {
    const cp = await import('child_process');
    vi.mocked(cp.execSync).mockReturnValue(JSON.stringify({ success: false, error: 'Bad format' }));

    const file = new File(['dummy-pdf-content'], 'test.pdf', { type: 'application/pdf' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(422);
    const d = await res.json();
    expect(d.error).toContain('Bad format');
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const file = new File(['data'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeFormReq(file));
    expect(res.status).toBe(500);
  });
});
