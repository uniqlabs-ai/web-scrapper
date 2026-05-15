import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    receipt: { create: vi.fn(), update: vi.fn() }
  },
}));

vi.mock('@/lib/document-intelligence', () => ({ parseReceiptWithAI: vi.fn() }));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { parseReceiptWithAI } from '@/lib/document-intelligence';
import { POST } from '@/app/api/receipts/upload/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);
const mparse = vi.mocked(parseReceiptWithAI);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('POST /api/receipts/upload', () => {
  function makeReq(file?: File): NextRequest {
    const formData = new FormData();
    if (file) formData.append('file', file);
    return new NextRequest(new URL('http://localhost:3008/api/receipts/upload'), {
      method: 'POST',
      body: formData,
    });
  }

  it('returns 400 if no file uploaded', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
  });

  it('returns 400 if file exceeds 5MB', async () => {
    const bigBuffer = new ArrayBuffer(6 * 1024 * 1024);
    const file = new File([bigBuffer], 'big.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(file));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 for unsupported file types', async () => {
    const file = new File(['text'], 'test.txt', { type: 'text/plain' });
    const res = await POST(makeReq(file));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unsupported file type');
  });

  it('returns 500 if AI parsing fails (returns null)', async () => {
    const file = new File(['image'], 'test.jpg', { type: 'image/jpeg' });
    mp.receipt.create.mockResolvedValue({ id: 'r1' } as any);
    mparse.mockResolvedValue(null);
    mp.receipt.update.mockResolvedValue({} as any);

    const res = await POST(makeReq(file));
    expect(res.status).toBe(500);
    expect(mp.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: { status: 'failed' }
    }));
  });

  it('processes valid image receipt successfully', async () => {
    const file = new File(['image'], 'test.png', { type: 'image/png' });
    mp.receipt.create.mockResolvedValue({ id: 'r1' } as any);
    mparse.mockResolvedValue({
      vendorName: 'Acme',
      amount: 100,
      gstNumber: 'GST123',
      category: 'Software',
      date: '2024-01-01',
      confidence: 0.95
    } as any);
    mp.receipt.update.mockResolvedValue({} as any);

    const res = await POST(makeReq(file));
    expect(res.status).toBe(200);
    expect(mp.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'processed',
        extractedVendor: 'Acme',
        extractedAmount: 100
      })
    }));
  });

  it('processes valid PDF receipt successfully (fallbacks)', async () => {
    const file = new File(['pdf'], 'test.pdf', { type: 'application/pdf' });
    mp.receipt.create.mockResolvedValue({ id: 'r1' } as any);
    mparse.mockResolvedValue({
      vendorName: null,
      amount: null,
      gstNumber: null,
      category: null,
      date: null
    } as any); // Test fallbacks to null

    const res = await POST(makeReq(file));
    expect(res.status).toBe(200);
    expect(mp.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        extractedVendor: null,
        extractedAmount: null,
        confidence: 0.85 // default fallback
      })
    }));
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const file = new File(['image'], 'test.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(file));
    expect(res.status).toBe(500);
  });
});
