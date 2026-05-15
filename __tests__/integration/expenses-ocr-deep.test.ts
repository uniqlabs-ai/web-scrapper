import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    receipt: { create: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

const { mockText, mockGenerateContent, mockGetModel } = vi.hoisted(() => {
  const mockText = vi.fn().mockReturnValue(JSON.stringify({
    amount: 100,
    vendor: 'Store',
    date: '2024-01-01',
    confidence: 0.95
  }));
  const mockGenerateContent = vi.fn().mockResolvedValue({ response: { text: mockText } });
  const mockGetModel = vi.fn().mockReturnValue({ generateContent: mockGenerateContent });
  return { mockText, mockGenerateContent, mockGetModel };
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return mockGetModel(); }
  }
}));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/expenses/ocr/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  process.env.GEMINI_API_KEY = 'test-key';
  
  mockText.mockReturnValue(JSON.stringify({
    amount: 100,
    vendor: 'Store',
    date: '2024-01-01',
    confidence: 0.95
  }));
});

function makeFormDataReq(fileName: string | null): NextRequest {
  const form = new FormData();
  if (fileName) {
    const file = new File(['fake-image'], fileName, { type: 'image/jpeg' });
    form.append('file', file);
  }
  const req = new NextRequest(new URL('http://localhost:3008/api/expenses/ocr'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=---' }),
    body: 'fake-body', // avoid undici issues
  });
  req.formData = async () => form;
  return req;
}

function makeJsonReq(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/expenses/ocr'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
}

describe('POST /api/expenses/ocr', () => {
  it('returns 400 when no file uploaded in multipart', async () => {
    const res = await POST(makeFormDataReq(null));
    expect(res.status).toBe(400);
  });

  it('processes multipart form data successfully', async () => {
    mp.receipt.create.mockResolvedValue({ id: 'r1', fileName: 'test.jpg', status: 'processed', confidence: 0.95 } as any);
    const res = await POST(makeFormDataReq('test.jpg'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.extracted.amount).toBe(100);
    expect(mp.receipt.create).toHaveBeenCalled();
  });

  it('returns 400 when no image provided in JSON body', async () => {
    const res = await POST(makeJsonReq({}));
    expect(res.status).toBe(400);
  });

  it('processes JSON body base64 successfully', async () => {
    mp.receipt.create.mockResolvedValue({ id: 'r2', fileName: 'receipt.jpg', status: 'processed', confidence: 0.95 } as any);
    const res = await POST(makeJsonReq({ image: 'data:image/jpeg;base64,abc' }));
    expect(res.status).toBe(200);
    expect(mp.receipt.create).toHaveBeenCalled();
  });

  it('returns 503 if GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(makeJsonReq({ image: 'base64' }));
    expect(res.status).toBe(503);
  });

  it('returns 500 on Gemini parse error', async () => {
    mockText.mockReturnValue('not json');
    const res = await POST(makeFormDataReq('test.jpg'));
    expect(res.status).toBe(500);
  });

  it('returns 500 on unexpected error', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeFormDataReq('test.jpg'));
    expect(res.status).toBe(500);
  });
});
