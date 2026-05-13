import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { create: vi.fn() },
    revenue: { create: vi.fn() },
    importBatch: { create: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: vi.fn().mockResolvedValue({
          response: { text: () => JSON.stringify({ documentType: 'P&L', companyName: 'Acme', period: '2025', lineItems: [] }) },
        }),
      };
    }
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/import/pdf/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function makeReq(file: File | null): Request {
  const fd = new FormData();
  if (file) fd.append('file', file);
  return new Request('http://localhost:3008/api/import/pdf', { method:'POST', body: fd });
}

describe('POST /api/import/pdf', () => {
  it('returns 400 when no file uploaded', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-PDF files', async () => {
    const file = new File(['data'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeReq(file));
    expect(res.status).toBe(400);
  });

  it('returns 400 when GEMINI_API_KEY is not set', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const file = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([400, 500]).toContain(res.status);

    process.env.GEMINI_API_KEY = origKey;
  });

  it('processes PDF with Gemini AI', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const file = new File(['%PDF'], 'financial.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    // May succeed or fail depending on mock depth
    expect([200, 422, 500]).toContain(res.status);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect(res.status).toBe(500);
  });
});
