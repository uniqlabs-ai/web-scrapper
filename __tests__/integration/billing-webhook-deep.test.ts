import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/billing/webhook/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const SECRET = 'test-webhook-secret';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});

function signBody(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

function req(body: string, signature?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature) headers['x-razorpay-signature'] = signature;
  return new NextRequest(new URL('http://localhost:3008/api/billing/webhook'), {
    method: 'POST',
    headers,
    body,
  } as Record<string, unknown>);
}

describe('POST /api/billing/webhook', () => {
  it('returns 503 when webhook secret not configured', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const body = JSON.stringify({ event: 'test' });
    const res = await POST(req(body, 'some-sig'));
    expect(res.status).toBe(503);
  });

  it('returns 400 when signature missing', async () => {
    const body = JSON.stringify({ event: 'test' });
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing signature');
  });

  it('returns 400 when signature is invalid', async () => {
    const body = JSON.stringify({ event: 'test' });
    const res = await POST(req(body, 'invalid-signature'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid signature');
  });

  it('processes payment.captured event and upgrades plan', async () => {
    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
            notes: { organizationId: 'org-1', planId: 'pro' },
          },
        },
      },
    };
    const body = JSON.stringify(event);
    const sig = signBody(body);

    mp.organization.findUnique.mockResolvedValue({ planTier: 'free', razorpayId: null } as any);
    mp.organization.update.mockResolvedValue({} as any);

    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(mp.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'org-1' },
      data: { planTier: 'pro', razorpayId: 'pay_123' },
    }));
  });

  it('skips duplicate payment', async () => {
    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_dup',
            notes: { organizationId: 'org-1', planId: 'pro' },
          },
        },
      },
    };
    const body = JSON.stringify(event);
    const sig = signBody(body);

    mp.organization.findUnique.mockResolvedValue({ planTier: 'pro', razorpayId: 'pay_dup' } as any);

    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.duplicate).toBe(true);
    expect(mp.organization.update).not.toHaveBeenCalled();
  });

  it('handles payment.captured without notes', async () => {
    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_no_notes', notes: {} },
        },
      },
    };
    const body = JSON.stringify(event);
    const sig = signBody(body);

    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    // Should not call update since no organizationId/planId
    expect(mp.organization.update).not.toHaveBeenCalled();
  });

  it('handles non-payment.captured events', async () => {
    const event = { event: 'order.paid', payload: {} };
    const body = JSON.stringify(event);
    const sig = signBody(body);

    const res = await POST(req(body, sig));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('returns 500 on unexpected error', async () => {
    const event = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_err', notes: { organizationId: 'org-1', planId: 'pro' } } } },
    };
    const body = JSON.stringify(event);
    const sig = signBody(body);

    mp.organization.findUnique.mockRejectedValue(new Error('DB error'));
    const res = await POST(req(body, sig));
    expect(res.status).toBe(500);
  });
});
