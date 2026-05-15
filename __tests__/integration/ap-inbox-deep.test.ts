import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    expenseApproval: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    expenseCategory: { findFirst: vi.fn(), create: vi.fn() },
    expense: { update: vi.fn() },
    bankAccount: { findFirst: vi.fn(), update: vi.fn() },
    vendor: { findUnique: vi.fn() },
    bankTransaction: { create: vi.fn() },
    $transaction: vi.fn(async (ops) => Promise.all(ops)),
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

// Mock payout engine
vi.mock('@/lib/payouts', () => ({
  createRazorpayContact: vi.fn().mockResolvedValue('cont_123'),
  createFundAccount: vi.fn().mockResolvedValue('fa_123'),
  executePayout: vi.fn().mockResolvedValue('payout_123')
}));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, PATCH } from '@/app/api/ap-inbox/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('GET /api/ap-inbox', () => {
  it('returns list of pending approvals', async () => {
    mp.expenseApproval.findMany.mockResolvedValue([
      {
        id: 'app_1',
        approverId: 'u1',
        status: 'pending',
        createdAt: new Date(),
        expense: {
          id: 'exp_1',
          description: 'Software',
          amount: 500,
          currency: 'USD',
          date: new Date(),
          vendor: 'Acme',
          categoryId: 'cat_1',
          receipts: [{
            id: 'rec_1',
            fileName: 'bill.pdf',
            imageData: 'base64...',
            confidence: 0.95,
            extractedData: JSON.stringify({ total: 500 })
          }]
        }
      }
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/ap-inbox'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inbox.length).toBe(1);
    expect(data.inbox[0].approvalId).toBe('app_1');
    expect(data.inbox[0].receipt.extraction.total).toBe(500);
  });

  it('handles missing receipts or malformed extracted data gracefully', async () => {
    mp.expenseApproval.findMany.mockResolvedValue([
      {
        id: 'app_1',
        createdAt: new Date(),
        expense: {
          id: 'exp_1',
          amount: 500,
          date: new Date(),
          receipts: [{
            extractedData: 'invalid json'
          }]
        }
      }
    ] as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/ap-inbox'));
    const res = await GET(req);
    const data = await res.json();
    expect(data.inbox[0].receipt.extraction).toEqual({});
  });

  it('returns 500 on unexpected errors', async () => {
    mt.mockRejectedValue(new Error('Auth error'));
    const req = new NextRequest(new URL('http://localhost:3008/api/ap-inbox'));
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/ap-inbox', () => {
  function makeReq(body: any): NextRequest {
    return new NextRequest(new URL('http://localhost:3008/api/ap-inbox'), {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  }

  it('returns 400 when fields are missing', async () => {
    const res = await PATCH(makeReq({ action: 'approve' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when approval is not found', async () => {
    mp.expenseApproval.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'approve' }));
    expect(res.status).toBe(404);
  });

  it('rejects an approval', async () => {
    mp.expenseApproval.findFirst.mockResolvedValue({ id: 'app_1', expense: {} } as any);
    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'reject' }));
    expect(res.status).toBe(200);
    expect(mp.expenseApproval.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'rejected' }
    }));
  });

  it('approves an expense without payout if bank account is missing', async () => {
    mp.expenseApproval.findFirst.mockResolvedValue({
      id: 'app_1',
      expense: { id: 'exp_1', amount: 500, vendor: 'Acme', categoryId: 'cat_1' }
    } as any);
    mp.bankAccount.findFirst.mockResolvedValue(null);

    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'approve' }));
    expect(res.status).toBe(200);
    expect(mp.expense.update).toHaveBeenCalled();
    expect(mp.expenseApproval.update).toHaveBeenCalled();
  });

  it('approves an expense and halts payout if vendor is missing', async () => {
    mp.expenseApproval.findFirst.mockResolvedValue({
      id: 'app_1',
      expense: { id: 'exp_1', amount: 500, vendor: 'Acme', categoryId: 'cat_1' } // no vendorId
    } as any);
    mp.bankAccount.findFirst.mockResolvedValue({ id: 'acc_1' } as any);

    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'approve' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('not linked to an onboarded Vendor');
  });

  it('approves an expense and halts payout if vendor lacks bank details', async () => {
    mp.expenseApproval.findFirst.mockResolvedValue({
      id: 'app_1',
      expense: { id: 'exp_1', amount: 500, vendor: 'Acme', categoryId: 'cat_1', vendorId: 'v1' }
    } as any);
    mp.bankAccount.findFirst.mockResolvedValue({ id: 'acc_1' } as any);
    mp.vendor.findUnique.mockResolvedValue({ id: 'v1' } as any); // no bank details

    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'approve' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('lacks registered Bank Account');
  });

  it('approves an expense and initiates authentic payout', async () => {
    mp.expenseApproval.findFirst.mockResolvedValue({
      id: 'app_1',
      expense: { id: 'exp_1', amount: 500, vendor: 'Acme', categoryId: 'cat_1', vendorId: 'v1', organizationId: 'org1' }
    } as any);
    mp.bankAccount.findFirst.mockResolvedValue({ id: 'acc_1' } as any);
    mp.vendor.findUnique.mockResolvedValue({ id: 'v1', bankName: 'HDFC', bankAccount: '123', bankIfsc: 'HDFC001' } as any);
    
    // finalCategory implies category upsert
    mp.expenseCategory.findFirst.mockResolvedValue(null);
    mp.expenseCategory.create.mockResolvedValue({ id: 'cat_new' } as any);

    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'approve', finalCategory: 'NewCat' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    expect(mp.expenseCategory.create).toHaveBeenCalled();
    expect(mp.expense.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ categoryId: 'cat_new' })
    }));
    expect(mp.bankTransaction.create).toHaveBeenCalled();
    expect(mp.$transaction).toHaveBeenCalled();
  });

  it('returns 400 for invalid action', async () => {
    mp.expenseApproval.findFirst.mockResolvedValue({ id: 'app_1', expense: {} } as any);
    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'invalid' }));
    expect(res.status).toBe(400);
  });

  it('hits missing false branches in GET and PATCH', async () => {
    // For GET: string error in JSON.parse, r.confidence is 0, empty receipts, extractedData null
    mp.expenseApproval.findMany.mockResolvedValue([
      {
        id: 'app_1',
        createdAt: new Date(),
        expense: {
          id: 'exp_1',
          amount: 500,
          date: new Date(),
          receipts: [{
            extractedData: 'invalid json',
            confidence: 0 // hits Number(r.confidence)
          }]
        }
      },
      {
        id: 'app_2',
        createdAt: new Date(),
        expense: {
          id: 'exp_2', amount: 100, date: new Date(),
          receipts: [] // hits r ? null : null false branch
        }
      },
      {
        id: 'app_3',
        createdAt: new Date(),
        expense: {
          id: 'exp_3', amount: 100, date: new Date(),
          receipts: [{ extractedData: null, confidence: 1 }] // hits r?.extractedData false branch
        }
      }
    ] as any);

    // Make JSON.parse throw a string to hit string error branch
    const origParse = JSON.parse;
    JSON.parse = vi.fn().mockImplementation(() => { throw 'String Error'; });

    let req = new NextRequest(new URL('http://localhost:3008/api/ap-inbox'));
    let res = await GET(req);
    expect(res.status).toBe(200);

    JSON.parse = origParse; // restore

    // For PATCH: cat exists, vendor is null, bankName is null, category is null
    mp.expenseApproval.findFirst.mockResolvedValue({
      id: 'app_1',
      expense: { id: 'exp_1', amount: 500, vendor: null, categoryId: null, vendorId: 'v1', organizationId: 'org1', currency: null }
    } as any);
    mp.bankAccount.findFirst.mockResolvedValue({ id: 'acc_1' } as any);
    mp.vendor.findUnique.mockResolvedValue({ id: 'v1', bankName: null, bankAccount: '123', bankIfsc: 'HDFC001' } as any);
    
    // cat exists
    mp.expenseCategory.findFirst.mockResolvedValue({ id: 'cat_exist' } as any);

    // Provide finalAmount but no finalVendor or finalCategory to hit fallbacks
    // Oh wait, if finalCategory is falsy, the `if (finalCategory)` block doesn't run.
    // Let's pass finalCategory so `cat exists` runs, but we want `finalCategory || "Uncategorized"` fallback for bank transaction if finalCategory was somehow empty. Wait, if finalCategory is '   ' or something? No, if `finalCategory` is falsy, it uses "Uncategorized" in bank txn creation!
    // But if `finalCategory` is falsy, it won't run `if (finalCategory)`.
    // That means `category: finalCategory || "Uncategorized"` will evaluate to "Uncategorized"!
    req = makeReq({ approvalId: 'app_1', action: 'approve', finalAmount: 600 });
    res = await PATCH(req);
    expect(res.status).toBe(200);
    
    // Run again with finalCategory to hit `cat exists` false branch (which means it's true, because it's if (!cat))
    req = makeReq({ approvalId: 'app_1', action: 'approve', finalCategory: 'ExistingCat' });
    res = await PATCH(req);
    expect(res.status).toBe(200);
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await PATCH(makeReq({ approvalId: 'app_1', action: 'approve' }));
    expect(res.status).toBe(500);
  });
});
