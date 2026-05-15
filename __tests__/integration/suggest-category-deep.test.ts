import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

const { mockText, mockGenerateContent, mockGetModel } = vi.hoisted(() => {
  const mockText = vi.fn().mockReturnValue('Food & Meals');
  const mockGenerateContent = vi.fn().mockResolvedValue({ response: { text: mockText } });
  const mockGetModel = vi.fn().mockReturnValue({ generateContent: mockGenerateContent });
  return { mockText, mockGenerateContent, mockGetModel };
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return mockGetModel(); }
  }
}));

import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/expenses/suggest-category/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  process.env.GEMINI_API_KEY = 'test-key';
  mockText.mockReturnValue('Food & Meals');
});

function makeReq(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/expenses/suggest-category'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
}

describe('POST /api/expenses/suggest-category', () => {
  it('returns 400 when missing description', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('matches fast rules for AWS', async () => {
    const res = await POST(makeReq({ description: 'Amazon Web Services', vendor: 'AWS' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe('Cloud Infrastructure');
    expect(data.source).toBe('rules');
  });

  it('matches fast rules for food', async () => {
    const res = await POST(makeReq({ description: 'Lunch for team', vendor: 'Zomato' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe('Food & Meals');
  });

  it('falls back to Gemini API when rules fail', async () => {
    const res = await POST(makeReq({ description: 'Weird purchase', vendor: 'Unknown' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe('Food & Meals'); // Gemini mocked return
    expect(data.source).toBe('ai');
  });

  it('returns Uncategorized if Gemini throws', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('AI failed'));
    const res = await POST(makeReq({ description: 'Weird purchase', vendor: 'Unknown' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe('Uncategorized');
    expect(data.source).toBe('default');
  });

  it('returns Uncategorized if GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(makeReq({ description: 'Weird purchase', vendor: 'Unknown' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe('Uncategorized');
    expect(data.source).toBe('default');
  });

  it('returns Uncategorized on unexpected exception', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq({ description: 'Rent' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe('Uncategorized');
    expect(data.source).toBe('error');
  });

  it('falls back to AI without vendor and amount params', async () => {
    const res = await POST(makeReq({ description: 'Weird thing' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe('ai');
  });

  it('falls back to AI with vendor but no amount', async () => {
    const res = await POST(makeReq({ description: 'Weird thing', vendor: 'SomeVendor' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe('ai');
  });

  it('handles AI response returning empty text fallback to Uncategorized', async () => {
    mockText.mockReturnValue('');
    const res = await POST(makeReq({ description: 'Weird thing' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe('Uncategorized');
    expect(data.source).toBe('ai');
  });
});
