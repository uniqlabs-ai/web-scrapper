import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    receipt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    expense: { create: vi.fn() },
    expenseApproval: { create: vi.fn() },
  },
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => '{"amount": 1500, "vendor": "CCD", "confidence": 0.9}' },
      }),
    }),
  })),
}));
vi.mock('@/lib/webhooks', () => ({ verifyWebhookSignature: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { verifyWebhookSignature } from '@/lib/webhooks';
import { POST } from '@/app/api/webhooks/inbound-email/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mVerify = vi.mocked(verifyWebhookSignature);

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    from: 'Jane Doe <jane@company.com>',
    subject: 'Bill from CCD',
    attachments: [{
      content: 'base64data',
      filename: 'bill.png',
      content_type: 'image/png',
    }],
    ...overrides,
  };
}

function req(body: unknown): NextRequest {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(new URL('http://localhost:3008/api/webhooks/inbound-email'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  } as Record<string, unknown>);
}

describe('POST /api/webhooks/inbound-email', () => {
  beforeEach(() => {
    mVerify.mockReturnValue(true);
  });

  // ── Signature & payload validation (no Gemini needed) ──
  it('returns 401 when webhook signature is invalid', async () => {
    mVerify.mockReturnValue(false);
    const res = await POST(req(makePayload()));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('Invalid');
  });

  it('returns 200 when email has no attachments (validation error, graceful 200)', async () => {
    const res = await POST(req(makePayload({ attachments: [] })));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe('Validation failed');
  });

  it('returns 200 when email has null attachments', async () => {
    const res = await POST(req(makePayload({ attachments: null })));
    expect(res.status).toBe(200);
  });

  it('returns 200 for non-image attachment types', async () => {
    const payload = makePayload({
      attachments: [{ content: 'pdf-data', filename: 'doc.pdf', content_type: 'application/pdf' }],
    });
    const res = await POST(req(payload));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain('Unsupported');
  });

  it('returns 503 when GEMINI_API_KEY is not configured', async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const res = await POST(req(makePayload()));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('Gemini');
    process.env.GEMINI_API_KEY = original;
  });

  it('returns 400 when body is invalid JSON', async () => {
    const badReq = new NextRequest(new URL('http://localhost:3008/api/webhooks/inbound-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    } as Record<string, unknown>);
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });

  it('returns 401 when signature header is missing', async () => {
    mVerify.mockReturnValue(false);
    const noSigReq = new NextRequest(new URL('http://localhost:3008/api/webhooks/inbound-email'), {
      method: 'POST',
      body: JSON.stringify(makePayload()),
    } as Record<string, unknown>);
    const res = await POST(noSigReq);
    expect(res.status).toBe(401);
  });

  it('hits fallback branches when Gemini OCR returns missing fields', async () => {
    // 1. Temporarily override process.env
    process.env.GEMINI_API_KEY = 'test_key';
    
    // 2. Find sender user
    mp.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: 'org1' } as any);
    
    // 3. Prevent duplicate receipt
    mp.receipt.findFirst.mockResolvedValue(null);
    
    // 4. Return incomplete JSON from Gemini
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const mGenerateContent = vi.fn().mockResolvedValue({
      response: { text: () => '{}' } // empty JSON object
    });
    (GoogleGenerativeAI as any).mockImplementation(function() {
      return { getGenerativeModel: () => ({ generateContent: mGenerateContent }) };
    });
    mp.receipt.create.mockResolvedValue({ id: 'rec1' } as any);
    mp.expense.create.mockResolvedValue({ id: 'exp1' } as any);

    const { log } = await import('@/lib/logger');
    const res = await POST(req(makePayload()));
    if (res.status !== 200) {
      console.log('LOG ERROR ARGS:', JSON.stringify(vi.mocked(log.error).mock.calls, null, 2));
    }
    expect(res.status).toBe(200);

    // Verify it used fallbacks
    expect(mp.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ extractedAmount: null, extractedVendor: null, extractedCategory: null })
    }));
    
    expect(mp.expense.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 0, vendor: 'Unknown Vendor', description: 'Bill from CCD' })
    }));
  });
});
