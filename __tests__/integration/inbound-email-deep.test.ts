import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    receipt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    expense: { create: vi.fn() },
    expenseApproval: { create: vi.fn() }
  },
}));

vi.mock('@/lib/webhooks', () => ({ verifyWebhookSignature: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  }
}));

import { prisma } from '@/lib/prisma';
import { verifyWebhookSignature } from '@/lib/webhooks';
import { POST } from '@/app/api/webhooks/inbound-email/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mv = vi.mocked(verifyWebhookSignature);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mv.mockReturnValue(true);
  process.env.GEMINI_API_KEY = 'test_key';
});

describe('POST /api/webhooks/inbound-email', () => {
  function makeReq(body: any, sig = 'sig'): NextRequest {
    return new NextRequest(new URL('http://localhost:3008/api/webhooks/inbound-email'), {
      method: 'POST',
      headers: new Headers({ 'x-webhook-signature': sig, 'content-type': 'application/json' }),
      body: JSON.stringify(body)
    });
  }

  it('returns 401 on invalid signature', async () => {
    mv.mockReturnValue(false);
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
  });

  it('returns 200 if no attachments', async () => {
    const res = await POST(makeReq({ from: 'test@test.com', subject: 'test', attachments: [] }));
    expect(res.status).toBe(200);
  });

  it('returns 200 if attachment is not image', async () => {
    const res = await POST(makeReq({ from: 'test@test.com', subject: 'test', attachments: [{ content_type: 'application/pdf', content: '', filename: 'test.pdf' }] }));
    expect(res.status).toBe(200);
  });

  it('returns 503 if GEMINI_API_KEY missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(makeReq({ from: 'test@test.com', subject: 'test', attachments: [{ content_type: 'image/png', content: 'base64', filename: 'test.png' }] }));
    expect(res.status).toBe(503);
  });

  it('returns 200 if sender email unrecognized', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ amount: 100 }) } });
    mp.user.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ from: 'Test <test@test.com>', subject: 'test', attachments: [{ content_type: 'image/png', content: 'base64', filename: 'test.png' }] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error).toBe('Sender email is not linked to any active user.');
  });

  it('returns 200 if receipt is duplicate', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ amount: 100 }) } });
    mp.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: 'org1' } as any);
    mp.receipt.findFirst.mockResolvedValue({ id: 'r1' } as any);

    const res = await POST(makeReq({ from: 'test@test.com', subject: 'test', attachments: [{ content_type: 'image/png', content: 'base64', filename: 'test.png' }] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.duplicate).toBe(true);
  });

  it('processes receipt successfully', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ amount: 100, vendor: 'Acme', description: 'desc', currency: 'USD', category: 'Food' }) } });
    mp.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: 'org1' } as any);
    mp.receipt.findFirst.mockResolvedValue(null);
    mp.receipt.create.mockResolvedValue({ id: 'r1' } as any);
    mp.expense.create.mockResolvedValue({ id: 'e1' } as any);

    const res = await POST(makeReq({ from: 'test@test.com', subject: 'test', attachments: [{ content_type: 'image/png', content: 'base64', filename: 'test.png' }] }));
    expect(res.status).toBe(200);
    expect(mp.receipt.create).toHaveBeenCalled();
    expect(mp.expense.create).toHaveBeenCalled();
    expect(mp.receipt.update).toHaveBeenCalled();
    expect(mp.expenseApproval.create).toHaveBeenCalled();
  });

  it('returns 500 on parse error', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'invalid-json' } });
    const res = await POST(makeReq({ from: 'test@test.com', subject: 'test', attachments: [{ content_type: 'image/png', content: 'base64', filename: 'test.png' }] }));
    expect(res.status).toBe(500);
  });
});
