import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: mockGenerateContent }; }
  }
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    receipt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    expense: { create: vi.fn() },
    expenseApproval: { create: vi.fn() },
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/webhooks', () => ({ verifyWebhookSignature: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { verifyWebhookSignature } from '@/lib/webhooks';
import { POST } from '@/app/api/webhooks/inbound-email/route';

const mp = vi.mocked(prisma);
const mw = vi.mocked(verifyWebhookSignature);

beforeEach(() => {
  vi.clearAllMocks();
  mw.mockReturnValue(true);
  process.env.GEMINI_API_KEY = 'test-key';
  
  mockGenerateContent.mockResolvedValue({
    response: { text: () => '{"category":"Software","confidence":0.9,"description":"Test","amount":5000,"vendor":"Vendor","date":"2025-01-01"}' }
  });
  
  (mp.user.findFirst as any).mockResolvedValue({ id: 'u1', organizationId: 'org-1' });
  (mp.receipt.findFirst as any).mockResolvedValue(null);
  (mp.receipt.create as any).mockResolvedValue({ id: 'r1' });
  (mp.expense.create as any).mockResolvedValue({ id: 'e1' });
});

function req(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/webhooks/inbound-email'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': 'sig' },
  });
}

describe('POST /api/webhooks/inbound-email', () => {
  it('rejects invalid signature', async () => {
    mw.mockReturnValue(false);
    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });

  it('returns 200 and ignores if no attachments', async () => {
    const res = await POST(req({ attachments: [] }));
    expect(res.status).toBe(200);
  });

  it('returns 200 and ignores if attachment is not an image', async () => {
    const res = await POST(req({
      from: 'test@test.com',
      subject: 'Bill',
      attachments: [{ content_type: 'application/pdf', filename: 'bill.pdf', content: 'base64' }]
    }));
    expect(res.status).toBe(200);
  });

  it('returns 503 if GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(req({
      from: 'test@test.com',
      subject: 'Bill',
      attachments: [{ content_type: 'image/png', filename: 'bill.png', content: 'base64' }]
    }));
    expect(res.status).toBe(503);
  });

  it('throws and logs error if OCR JSON parsing fails', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'invalid-json' } });
    const res = await POST(req({
      from: 'test@test.com',
      subject: 'Bill',
      attachments: [{ content_type: 'image/png', filename: 'bill.png', content: 'base64' }]
    }));
    expect(res.status).toBe(500); // Throws -> caught by global catch -> returns 500
  });

  it('returns 200 if sender email is not found in users', async () => {
    (mp.user.findFirst as any).mockResolvedValue(null);
    const res = await POST(req({
      from: 'Test User <unknown@test.com>',
      subject: 'Bill',
      attachments: [{ content_type: 'image/png', filename: 'bill.png', content: 'base64' }]
    }));
    expect(res.status).toBe(200); // Prevents webhook retries
  });

  it('returns 200 duplicate skipped if receipt already exists', async () => {
    (mp.receipt.findFirst as any).mockResolvedValue({ id: 'r-exist' });
    const res = await POST(req({
      from: 'test@test.com',
      subject: 'Bill',
      attachments: [{ content_type: 'image/png', filename: 'bill.png', content: 'base64' }]
    }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.duplicate).toBe(true);
  });

  it('processes valid image attachment, calls OCR, and creates expense and approval', async () => {
    const res = await POST(req({
      from: 'Test <test@test.com>',
      subject: 'AWS Bill',
      attachments: [{ content_type: 'image/png', filename: 'bill.png', content: 'base64-data' }]
    }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.success).toBe(true);
    expect(mp.receipt.create).toHaveBeenCalled();
    expect(mp.expense.create).toHaveBeenCalled();
    expect(mp.receipt.update).toHaveBeenCalled();
    expect(mp.expenseApproval.create).toHaveBeenCalled();
  });
});
