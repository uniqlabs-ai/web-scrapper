import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    receipt: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    expense: { create: vi.fn() },
    vendor: { findFirst: vi.fn(), create: vi.fn() },
    expenseCategory: { findFirst: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/document-intelligence', () => ({ parseReceiptWithAI: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { parseReceiptWithAI } from '@/lib/document-intelligence';
import { requirePermission } from '@/lib/guards';
import { GET as getReceipts, POST as postReceipts } from '@/app/api/receipts/route';
import { POST as uploadReceipt } from '@/app/api/receipts/upload/route';
import { DELETE as deleteReceipt, GET as getReceipt } from '@/app/api/receipts/[id]/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const mAI = vi.mocked(parseReceiptWithAI);
const mg = vi.mocked(requirePermission);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mg.mockResolvedValue({ allowed: true, response: null, userId: 'u1' } as any);
  mp.user.findUnique.mockResolvedValue({ organizationId: 'org-1' } as any);
});

function jsonReq(method='GET', url='http://localhost:3008/api/receipts', body?:unknown): NextRequest {
  const init: Record<string, unknown> = { method };
  if (body) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  return new NextRequest(new URL(url), init);
}

// ── GET /api/receipts ──
describe('GET /api/receipts', () => {
  it('returns receipts list with converted decimals', async () => {
    mp.receipt.findMany.mockResolvedValue([{
      id: 'r1', fileName: 'bill.png', mimeType: 'image/png', status: 'processed',
      createdAt: new Date(), expenseId: null, expense: null,
      extractedAmount: 5000, extractedVendor: 'Shop', extractedDate: new Date(),
      extractedGst: '22AAAAA0000A1Z5', extractedCategory: 'Food',
      confidence: 0.92, extractedData: '{"amount":5000}',
    }] as any);
    const res = await getReceipts(jsonReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.receipts).toHaveLength(1);
    expect(data.receipts[0].extractedAmount).toBe(5000);
    expect(data.receipts[0].extractedData.amount).toBe(5000);
  });

  it('handles null amounts and confidence', async () => {
    mp.receipt.findMany.mockResolvedValue([{
      id: 'r1', fileName: 'bill.png', mimeType: 'image/png', status: 'failed',
      createdAt: new Date(), expenseId: null, expense: null,
      extractedAmount: null, extractedVendor: null, extractedDate: null,
      extractedGst: null, extractedCategory: null,
      confidence: null, extractedData: null,
    }] as any);
    const res = await getReceipts(jsonReq());
    const data = await res.json();
    expect(data.receipts[0].extractedAmount).toBeNull();
    expect(data.receipts[0].confidence).toBeNull();
    expect(data.receipts[0].extractedData).toBeNull();
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await getReceipts(jsonReq());
    expect(res.status).toBe(500);
  });
});

// ── POST /api/receipts ──
describe('POST /api/receipts (convert to expense)', () => {
  it('converts receipt to expense successfully', async () => {
    mp.receipt.findUnique.mockResolvedValue({ id: 'r1', userId: 'u1', expenseId: null, fileName: 'bill.png' } as any);
    mp.vendor.findFirst.mockResolvedValue({ id: 'v1', name: 'Shop' } as any);
    mp.expenseCategory.findFirst.mockResolvedValue({ id: 'c1', name: 'Food' } as any);
    mp.expense.create.mockResolvedValue({ id: 'e1' } as any);
    mp.receipt.update.mockResolvedValue({} as any);

    const res = await postReceipts(jsonReq('POST', 'http://localhost:3008/api/receipts', {
      receiptId: 'r1', vendorName: 'Shop', amount: 500, date: '2025-01-15', category: 'Food',
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('creates new vendor when not found', async () => {
    mp.receipt.findUnique.mockResolvedValue({ id: 'r1', userId: 'u1', expenseId: null, fileName: 'bill.png' } as any);
    mp.vendor.findFirst.mockResolvedValue(null);
    mp.vendor.create.mockResolvedValue({ id: 'v-new', name: 'NewVendor' } as any);
    mp.expense.create.mockResolvedValue({ id: 'e1' } as any);
    mp.receipt.update.mockResolvedValue({} as any);

    const res = await postReceipts(jsonReq('POST', 'http://localhost:3008/api/receipts', {
      receiptId: 'r1', vendorName: 'NewVendor', amount: 500, date: '2025-01-15',
    }));
    expect(res.status).toBe(200);
    expect(mp.vendor.create).toHaveBeenCalled();
  });

  it('creates new category when not found', async () => {
    mp.receipt.findUnique.mockResolvedValue({ id: 'r1', userId: 'u1', expenseId: null, fileName: 'bill.png' } as any);
    mp.vendor.findFirst.mockResolvedValue({ id: 'v1' } as any);
    mp.expenseCategory.findFirst.mockResolvedValue(null);
    mp.expenseCategory.create.mockResolvedValue({ id: 'c-new', name: 'Travel' } as any);
    mp.expense.create.mockResolvedValue({ id: 'e1' } as any);
    mp.receipt.update.mockResolvedValue({} as any);

    const res = await postReceipts(jsonReq('POST', 'http://localhost:3008/api/receipts', {
      receiptId: 'r1', vendorName: 'Shop', amount: 500, date: '2025-01-15', category: 'Travel',
    }));
    expect(res.status).toBe(200);
    expect(mp.expenseCategory.create).toHaveBeenCalled();
  });

  it('returns 400 for missing required fields', async () => {
    const res = await postReceipts(jsonReq('POST', 'http://localhost:3008/api/receipts', { receiptId: 'r1' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when receipt not found', async () => {
    mp.receipt.findUnique.mockResolvedValue(null);
    const res = await postReceipts(jsonReq('POST', 'http://localhost:3008/api/receipts', {
      receiptId: 'missing', vendorName: 'Shop', amount: 500, date: '2025-01-15',
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when receipt already converted', async () => {
    mp.receipt.findUnique.mockResolvedValue({ id: 'r1', userId: 'u1', expenseId: 'e-existing' } as any);
    const res = await postReceipts(jsonReq('POST', 'http://localhost:3008/api/receipts', {
      receiptId: 'r1', vendorName: 'Shop', amount: 500, date: '2025-01-15',
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('already been converted');
  });

  it('returns 500 on DB error', async () => {
    mp.receipt.findUnique.mockRejectedValue(new Error('DB error'));
    const res = await postReceipts(jsonReq('POST', 'http://localhost:3008/api/receipts', {
      receiptId: 'r1', vendorName: 'Shop', amount: 500, date: '2025-01-15',
    }));
    expect(res.status).toBe(500);
  });
});

// ── POST /api/receipts/upload ──
describe('POST /api/receipts/upload', () => {
  function makeUploadReq(file?: File | null): NextRequest {
    const form = new FormData();
    if (file) form.append('file', file);
    return new NextRequest(new URL('http://localhost:3008/api/receipts/upload'), {
      method: 'POST',
      body: form,
    } as Record<string, unknown>);
  }

  it('uploads and processes receipt successfully', async () => {
    const file = new File(['fake-image-data'], 'receipt.jpg', { type: 'image/jpeg' });
    mp.receipt.create.mockResolvedValue({ id: 'r1' } as any);
    mAI.mockResolvedValue({ vendorName: 'Shop', amount: 500, confidence: 0.95, gstNumber: null, category: 'Food', date: '2025-01-15' } as any);
    mp.receipt.update.mockResolvedValue({} as any);

    const res = await uploadReceipt(makeUploadReq(file));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.receiptId).toBe('r1');
  });

  it('returns 400 when no file uploaded', async () => {
    const res = await uploadReceipt(makeUploadReq(null));
    expect(res.status).toBe(400);
  });

  it('handles AI parse failure', async () => {
    const file = new File(['fake'], 'receipt.jpg', { type: 'image/jpeg' });
    mp.receipt.create.mockResolvedValue({ id: 'r1' } as any);
    mAI.mockResolvedValue(null);
    mp.receipt.update.mockResolvedValue({} as any);

    const res = await uploadReceipt(makeUploadReq(file));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('Failed to extract');
  });

  it('returns 500 on unexpected error', async () => {
    mt.mockRejectedValue(new Error('auth fail'));
    const file = new File(['fake'], 'receipt.jpg', { type: 'image/jpeg' });
    const res = await uploadReceipt(makeUploadReq(file));
    expect(res.status).toBe(500);
  });
});

// ── GET/DELETE /api/receipts/[id] ──
describe('GET /api/receipts/[id]', () => {
  it('returns receipt by id', async () => {
    mp.receipt.findUnique.mockResolvedValue({ id: 'r1', fileName: 'bill.png', expense: null } as any);
    const r = jsonReq('GET', 'http://localhost:3008/api/receipts/r1');
    const res = await getReceipt(r, { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    mp.receipt.findUnique.mockResolvedValue(null);
    const r = jsonReq('GET', 'http://localhost:3008/api/receipts/missing');
    const res = await getReceipt(r, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const r = jsonReq('GET', 'http://localhost:3008/api/receipts/r1');
    const res = await getReceipt(r, { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/receipts/[id]', () => {
  it('deletes receipt successfully', async () => {
    mp.receipt.delete.mockResolvedValue({} as any);
    const r = jsonReq('DELETE', 'http://localhost:3008/api/receipts/r1');
    const res = await deleteReceipt(r, { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 403 when permission denied', async () => {
    const guardRes = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    mg.mockResolvedValue({ allowed: false, response: guardRes } as any);
    const r = jsonReq('DELETE', 'http://localhost:3008/api/receipts/r1');
    const res = await deleteReceipt(r, { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 when receipt not found (P2025)', async () => {
    const err: any = new Error('not found');
    err.code = 'P2025';
    mp.receipt.delete.mockRejectedValue(err);
    const r = jsonReq('DELETE', 'http://localhost:3008/api/receipts/r1');
    const res = await deleteReceipt(r, { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mp.receipt.delete.mockRejectedValue(new Error('DB error'));
    const r = jsonReq('DELETE', 'http://localhost:3008/api/receipts/r1');
    const res = await deleteReceipt(r, { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(500);
  });
});
