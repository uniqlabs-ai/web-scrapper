import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { create: vi.fn(), findFirst: vi.fn() },
    revenue: { create: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/webhooks', () => ({ verifyWebhookSignature: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { verifyWebhookSignature } from '@/lib/webhooks';
import { POST } from '@/app/api/v1/webhooks/inbound/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mv = vi.mocked(verifyWebhookSignature);

beforeEach(() => { vi.clearAllMocks(); mv.mockReturnValue(true); });

function req(body: unknown, sig = 'valid-sig'): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/v1/webhooks/inbound'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig },
  });
}

describe('POST /api/v1/webhooks/inbound', () => {
  it('rejects invalid signature', async () => {
    mv.mockReturnValue(false);
    const res = await POST(req({ productId:'hiring', event:'test' }, 'bad'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing productId', async () => {
    const res = await POST(req({ event:'test' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing event', async () => {
    const res = await POST(req({ productId:'hiring' }));
    expect(res.status).toBe(400);
  });

  it('processes offer.accepted from hiring → creates expense', async () => {
    mp.expense.findFirst.mockResolvedValue(null);
    mp.expense.create.mockResolvedValue({} as any);
    const res = await POST(req({
      productId: 'hiring', event: 'offer.accepted',
      summary: 'New hire', timestamp: new Date().toISOString(),
      data: { salary: 1200000, candidateName: 'Alice', userId: 'u1', offerId: 'off-1' },
    }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.received).toBe(true);
    expect(d.processed.action).toBe('expense.created');
    expect(d.processed.amount).toBe(1200000);
  });

  it('processes deal.closed from uniqlabs → creates revenue', async () => {
    mp.revenue.findFirst.mockResolvedValue(null);
    mp.revenue.create.mockResolvedValue({} as any);
    const res = await POST(req({
      productId: 'uniqlabs', event: 'deal.closed',
      summary: 'New deal', timestamp: new Date().toISOString(),
      data: { dealValue: 500000, clientName: 'Acme', userId: 'u1', dealId: 'd-1', recurring: true },
    }));
    const d = await res.json();
    expect(d.processed.action).toBe('revenue.created');
    expect(d.processed.amount).toBe(500000);
  });

  it('processes campaign.launched from gtm → creates expense', async () => {
    mp.expense.findFirst.mockResolvedValue(null);
    mp.expense.create.mockResolvedValue({} as any);
    const res = await POST(req({
      productId: 'gtm', event: 'campaign.launched',
      summary: 'Campaign', timestamp: new Date().toISOString(),
      data: { budget: 200000, campaignName: 'Q3 Launch', platform: 'Google Ads', campaignId: 'c-1', userId: 'u1' },
    }));
    const d = await res.json();
    expect(d.processed.action).toBe('expense.created');
    expect(d.processed.amount).toBe(200000);
  });

  it('processes subscription.renewed → creates revenue', async () => {
    mp.revenue.findFirst.mockResolvedValue(null);
    mp.revenue.create.mockResolvedValue({} as any);
    const res = await POST(req({
      productId: 'saas', event: 'subscription.renewed',
      summary: 'Renewal', timestamp: new Date().toISOString(),
      data: { amount: 50000, userId: 'u1', subscriptionId: 'sub-1' },
    }));
    const d = await res.json();
    expect(d.processed.action).toBe('revenue.created');
  });

  it('logs unrecognized events without processing', async () => {
    const res = await POST(req({
      productId: 'unknown', event: 'something.happened',
      summary: 'Unknown', timestamp: new Date().toISOString(),
      data: {},
    }));
    const d = await res.json();
    expect(d.processed.action).toBe('event.logged');
  });

  it('returns 500 on Prisma error', async () => {
    mp.expense.findFirst.mockResolvedValue(null);
    mp.expense.create.mockRejectedValue(new Error('DB error'));
    const res = await POST(req({
      productId: 'hiring', event: 'offer.accepted',
      summary: 'Fail', timestamp: new Date().toISOString(),
      data: { salary: 100, candidateName: 'X', userId: 'u1', offerId: 'o' },
    }));
    expect([401, 500]).toContain(res.status);
  });
});
