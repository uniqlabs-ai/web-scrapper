import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findFirst: vi.fn(), create: vi.fn() },
    revenue: { findFirst: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/webhooks', () => ({ verifyWebhookSignature: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { verifyWebhookSignature } from '@/lib/webhooks';
import { POST } from '@/app/api/v1/webhooks/inbound/route';

const mp = vi.mocked(prisma);
const mw = vi.mocked(verifyWebhookSignature);

beforeEach(() => {
  vi.clearAllMocks();
  mw.mockReturnValue(true);
  // Mock organizationId resolution for tenant-scoped webhook processing
  (mp.user?.findUnique as any)?.mockResolvedValue({ organizationId: 'org-1' });
  (mp.expense.findFirst as any).mockResolvedValue(null);
  (mp.revenue.findFirst as any).mockResolvedValue(null);
});

function req(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/v1/webhooks/inbound'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': 'sig123' },
  });
}

describe('POST /api/v1/webhooks/inbound', () => {
  it('rejects invalid signature', async () => {
    mw.mockReturnValue(false);
    const res = await POST(req({ productId: 'hiring', event: 'offer.accepted' }));
    expect(res.status).toBe(401);
  });

  it('rejects missing productId or event', async () => {
    const res = await POST(req({ productId: 'hiring' })); // missing event
    expect(res.status).toBe(400);
  });

  it('handles offer.accepted (hiring) and creates expense', async () => {
    const res = await POST(req({
      productId: 'hiring',
      event: 'offer.accepted',
      summary: 'New hire',
      timestamp: new Date().toISOString(),
      data: { offerId: 'o1', salary: 100000, candidateName: 'John', userId: 'u1' }
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed.action).toBe('expense.created');
    expect(mp.expense.create).toHaveBeenCalled();
  });

  it('handles offer.accepted duplicate', async () => {
    (mp.expense.findFirst as any).mockResolvedValue({ id: 'e1' });
    const res = await POST(req({
      productId: 'hiring',
      event: 'offer.accepted',
      summary: 'New hire',
      timestamp: new Date().toISOString(),
      data: { offerId: 'o1', salary: 100000 }
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed.action).toBe('duplicate.skipped');
    expect(mp.expense.create).not.toHaveBeenCalled();
  });

  it('handles deal.closed (uniqlabs) and creates revenue', async () => {
    const res = await POST(req({
      productId: 'uniqlabs',
      event: 'deal.closed',
      summary: 'New deal',
      timestamp: new Date().toISOString(),
      data: { dealId: 'd1', dealValue: 50000, recurring: true }
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed.action).toBe('revenue.created');
    expect(mp.revenue.create).toHaveBeenCalled();
  });

  it('handles deal.closed duplicate', async () => {
    (mp.revenue.findFirst as any).mockResolvedValue({ id: 'r1' });
    const res = await POST(req({
      productId: 'uniqlabs',
      event: 'deal.closed',
      summary: 'New deal',
      timestamp: new Date().toISOString(),
      data: { dealId: 'd1', dealValue: 50000 }
    }));
    const data = await res.json();
    expect(data.processed.action).toBe('duplicate.skipped');
  });

  it('handles campaign.launched (gtm) and creates expense', async () => {
    const res = await POST(req({
      productId: 'gtm',
      event: 'campaign.launched',
      summary: 'New campaign',
      timestamp: new Date().toISOString(),
      data: { campaignId: 'c1', budget: 10000, campaignName: 'Summer Promo' }
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed.action).toBe('expense.created');
    expect(mp.expense.create).toHaveBeenCalled();
  });

  it('handles campaign.launched duplicate', async () => {
    (mp.expense.findFirst as any).mockResolvedValue({ id: 'e2' });
    const res = await POST(req({
      productId: 'gtm',
      event: 'campaign.launched',
      summary: 'New campaign',
      timestamp: new Date().toISOString(),
      data: { campaignId: 'c1', budget: 10000 }
    }));
    const data = await res.json();
    expect(data.processed.action).toBe('duplicate.skipped');
  });

  it('handles subscription.renewed and creates revenue', async () => {
    const res = await POST(req({
      productId: 'saas',
      event: 'subscription.renewed',
      summary: 'Renewal',
      timestamp: new Date().toISOString(),
      data: { subscriptionId: 's1', amount: 99 }
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed.action).toBe('revenue.created');
    expect(mp.revenue.create).toHaveBeenCalled();
  });

  it('handles subscription.renewed duplicate', async () => {
    (mp.revenue.findFirst as any).mockResolvedValue({ id: 'r2' });
    const res = await POST(req({
      productId: 'saas',
      event: 'subscription.renewed',
      summary: 'Renewal',
      timestamp: new Date().toISOString(),
      data: { subscriptionId: 's1', amount: 99 }
    }));
    const data = await res.json();
    expect(data.processed.action).toBe('duplicate.skipped');
  });

  it('handles unknown event types gracefully', async () => {
    const res = await POST(req({
      productId: 'unknown',
      event: 'unknown.event',
      summary: 'Something',
      timestamp: new Date().toISOString(),
      data: {}
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed.action).toBe('event.logged');
  });

  it('handles JSON parsing errors', async () => {
    const res = await POST(new NextRequest(new URL('http://localhost:3008/api/v1/webhooks/inbound'), {
      method: 'POST',
      body: 'invalid-json',
      headers: { 'x-webhook-signature': 'sig' }
    }));
    expect(res.status).toBe(400); // Returns 400 with "Invalid JSON payload"
  });
});
