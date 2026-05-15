import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    receipt: { create: vi.fn().mockResolvedValue({"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":50000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"processed","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[],"fileName":"bill.png","mimeType":"image/png","confidence":0.9}) }
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@google/generative-ai', () => { class M { getGenerativeModel() { return { generateContent: async () => ({ response: { text: () => '{"category":"Software","confidence":0.9,"description":"Test","amount":5000,"vendor":"Vendor","date":"2025-01-01"}' } }) }; } } return { GoogleGenerativeAI: M }; });

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/expenses/ocr/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/expenses/ocr'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('POST /api/expenses/ocr', () => {
  it('handles JSON body successfully', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const res = await POST(req('POST', { image: 'data:image/jpeg;base64,abc', mimeType: 'image/jpeg', fileName: 'test.jpg' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.receipt).toBeDefined();
    expect(data.extracted).toBeDefined();
  });

  it('handles multipart/form-data successfully', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const formData = new FormData();
    const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
    formData.append('file', file);
    
    const init = { method: 'POST', body: formData, headers: { 'Content-Type': 'multipart/form-data; boundary=---' } };
    const request = new NextRequest(new URL('http://localhost:3008/api/expenses/ocr'), init as any);
    
    // Polyfill formData for NextRequest
    request.formData = async () => formData;
    
    const res = await POST(request);
    expect(res.status).toBe(200);
  });

  it('returns 400 when multipart form has no file', async () => {
    const formData = new FormData();
    const init = { method: 'POST', body: formData, headers: { 'Content-Type': 'multipart/form-data; boundary=---' } };
    const request = new NextRequest(new URL('http://localhost:3008/api/expenses/ocr'), init as any);
    request.formData = async () => formData;
    
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it('returns 400 when JSON body has no image', async () => {
    const res = await POST(req('POST', { }));
    expect(res.status).toBe(400);
  });

  it('returns 503 when GEMINI_API_KEY is not configured', async () => {
    process.env.GEMINI_API_KEY = '';
    const res = await POST(req('POST', { image: 'base64str' }));
    expect(res.status).toBe(503);
  });

  it('uses default mimeType/fileName when not provided in JSON body', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const res = await POST(req('POST', { image: 'abc123' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.receipt).toBeDefined();
  });

  it('handles tenant error returning 500', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST', { image: 'base64str' }));
    expect(res.status).toBe(500);
  });

  it('handles multipart file with no explicit type (falls back to image/jpeg)', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const formData = new FormData();
    const file = new File(['data'], '', { type: '' });
    formData.append('file', file);

    const init = { method: 'POST', body: formData, headers: { 'Content-Type': 'multipart/form-data; boundary=---' } };
    const request = new NextRequest(new URL('http://localhost:3008/api/expenses/ocr'), init as any);
    request.formData = async () => formData;

    const res = await POST(request);
    expect(res.status).toBe(200);
  });

  it('strips data URI prefix from base64 image', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const res = await POST(req('POST', { image: 'data:image/png;base64,abc123' }));
    expect(res.status).toBe(200);
  });
});
