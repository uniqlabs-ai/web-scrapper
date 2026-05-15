import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({ id: 'order_123', amount: 990000, currency: 'INR' })
}));

vi.mock('razorpay', () => {
  return {
    default: class {
      orders = { create: mockCreate };
    }
  };
});

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/billing/checkout/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mockCreate.mockResolvedValue({ id: 'order_123', amount: 990000, currency: 'INR' });
});

function makeReq(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/billing/checkout'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
}

describe('POST /api/billing/checkout', () => {
  it('returns 400 for invalid payload', async () => {
    const res = await POST(makeReq({ planId: 'invalid' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 if org not found', async () => {
    mp.organization.findFirst.mockResolvedValue(null);
    const res = await POST(makeReq({ planId: 'professional' }));
    expect(res.status).toBe(404);
  });

  it('creates razorpay order successfully for professional plan', async () => {
    mp.organization.findFirst.mockResolvedValue({ id: 'org-1' } as any);
    const res = await POST(makeReq({ planId: 'professional' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.orderId).toBe('order_123');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: 990000
    }));
  });

  it('creates razorpay order successfully for enterprise plan', async () => {
    mp.organization.findFirst.mockResolvedValue({ id: 'org-1' } as any);
    mockCreate.mockResolvedValueOnce({ id: 'order_124', amount: 5000000, currency: 'INR' });
    const res = await POST(makeReq({ planId: 'enterprise' }));
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: 5000000
    }));
  });

  it('returns 500 on razorpay error', async () => {
    mp.organization.findFirst.mockResolvedValue({ id: 'org-1' } as any);
    mockCreate.mockRejectedValueOnce(new Error('Razorpay failed'));
    const res = await POST(makeReq({ planId: 'professional' }));
    expect(res.status).toBe(500);
  });

  it('returns 500 on auth error', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq({ planId: 'professional' }));
    expect(res.status).toBe(500);
  });
});
