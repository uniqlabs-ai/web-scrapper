import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Stripe before importing the route
vi.mock('stripe', () => {
  const mockConstructEvent = vi.fn();
  return {
    default: class MockStripe {
      webhooks = { constructEvent: mockConstructEvent };
      constructor() {}
    },
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    revenue: { findFirst: vi.fn(), create: vi.fn() },
    client: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/webhooks/stripe/route';
import Stripe from 'stripe';

const mp = vi.mocked(prisma);

beforeEach(() => { vi.clearAllMocks(); });

function req(sig?: string, body: string = '{}'): NextRequest {
  const headers: Record<string, string> = {};
  if (sig) headers['stripe-signature'] = sig;
  return new NextRequest(new URL('http://localhost:3008/api/webhooks/stripe'), {
    method: 'POST', body, headers,
  });
}

describe('POST /api/webhooks/stripe', () => {
  it('returns 400 when stripe-signature is missing', async () => {
    const res = await POST(req());
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.error).toContain('Missing');
  });

  it('returns 400 when signature verification fails', async () => {
    // The mock Stripe constructEvent will throw
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => { throw new Error('Signature mismatch'); });
    
    const res = await POST(req('sig_bad'));
    expect(res.status).toBe(400);
  });

  it('handles valid invoice.payment_succeeded event', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_test_123',
          customer: 'cus_123',
          customer_name: 'Test Customer',
          customer_email: 'test@example.com',
          amount_paid: 10000,
          currency: 'usd',
          number: 'INV-001',
          created: Math.floor(Date.now() / 1000),
          lines: { data: [{ price: { type: 'recurring' } }] },
        },
      },
    } as any);

    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1', organizationId: 'org-1' });
    (mp.revenue.findFirst as any).mockResolvedValue(null); // no duplicate
    (mp.$transaction as any).mockImplementation(async (fn: any) => {
      const tx = {
        client: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'c-new' }) },
        revenue: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.received).toBe(true);
  });

  it('handles duplicate event idempotently', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: {
        object: { id: 'in_dup', customer: 'cus_123', amount_paid: 5000, currency: 'usd', created: Date.now()/1000, lines: { data: [] } },
      },
    } as any);
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1', organizationId: 'org-1' });
    (mp.revenue.findFirst as any).mockResolvedValue({ id: 'existing-rev' }); // duplicate!

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.duplicate).toBe(true);
  });

  it('handles existing client for invoice event', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: {
        object: { id: 'in_test_1234', customer: 'cus_1234', amount_paid: 10000, currency: 'usd', created: Math.floor(Date.now() / 1000), lines: { data: [] } },
      },
    } as any);

    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1', organizationId: 'org-1' });
    (mp.revenue.findFirst as any).mockResolvedValue(null);
    (mp.$transaction as any).mockImplementation(async (fn: any) => {
      const tx = {
        client: { findFirst: vi.fn().mockResolvedValue({ id: 'c-exist' }), create: vi.fn() },
        revenue: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(200);
  });

  it('throws error if admin user not found', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_test_1234' } },
    } as any);

    (mp.user.findFirst as any).mockResolvedValue(null); // no admin!

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(500);
  });

  it('handles subscription.deleted event', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_123' } },
    } as any);
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1', organizationId: 'org-1' });

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(200);
  });

  it('handles invoice with null customer_name and customer_email', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_null_names',
          customer: 'cus_999',
          customer_name: null,
          customer_email: null,
          amount_paid: 5000,
          currency: 'usd',
          number: null,
          created: Math.floor(Date.now() / 1000),
          lines: { data: [] },
        },
      },
    } as any);
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1', organizationId: 'org-1' });
    (mp.revenue.findFirst as any).mockResolvedValue(null);
    (mp.$transaction as any).mockImplementation(async (fn: any) => {
      const tx = {
        client: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'c-new' }) },
        revenue: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(200);
  });

  it('handles subscription.deleted with customer as object', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { customer: { id: 'cus_obj_456' } } },
    } as any);
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1', organizationId: 'org-1' });

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(200);
  });

  it('handles invoice with customer as object', async () => {
    const stripe = new Stripe('sk_test', { apiVersion: '2024-12-18.acacia' as any });
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_cust_obj',
          customer: { id: 'cus_obj_789' },
          customer_name: 'ObjCustomer',
          customer_email: 'obj@test.com',
          amount_paid: 2000,
          currency: 'usd',
          created: Math.floor(Date.now() / 1000),
          lines: { data: [{ price: { type: 'one_time' } }] },
        },
      },
    } as any);
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1', organizationId: 'org-1' });
    (mp.revenue.findFirst as any).mockResolvedValue(null);
    (mp.$transaction as any).mockImplementation(async (fn: any) => {
      const tx = {
        client: { findFirst: vi.fn().mockResolvedValue({ id: 'c-exist' }), create: vi.fn() },
        revenue: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await POST(req('sig_valid'));
    expect(res.status).toBe(200);
  });
});
