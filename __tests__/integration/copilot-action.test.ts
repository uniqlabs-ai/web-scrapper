import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { create: vi.fn(), count: vi.fn() },
    expense: { create: vi.fn() },
    revenue: { create: vi.fn() },
    account: { update: vi.fn() },
  },
}));
vi.mock('@/lib/founder-os-jwt', () => ({ extractFounderOSToken: vi.fn().mockReturnValue({ sub: 'fos-u1', organizationId: 'org-1' }) }));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('uuid', () => ({ v4: vi.fn().mockReturnValue('mock-uuid') }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/v1/copilot/action/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function req(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/v1/copilot/action'), {
    method:'POST', body:JSON.stringify(body), headers:{'Content-Type':'application/json'},
  });
}

describe('POST /api/v1/copilot/action', () => {
  it('returns 400 when action is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('creates an invoice via createInvoice action', async () => {
    (mp.invoice.count as any).mockResolvedValue(5);
    (mp.invoice.create as any).mockResolvedValue({ id:'inv-new', invoiceNumber:'INV-0006', lineItems:[] });
    const res = await POST(req({
      action: 'createInvoice',
      params: {
        dueDate: '2025-05-15',
        lineItems: [{ description:'Consulting', quantity:1, unitPrice:100000, gstRate:18 }],
      },
    }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
    expect(d.action).toBe('createInvoice');
  });

  it('returns 400 for createInvoice without lineItems', async () => {
    const res = await POST(req({
      action: 'createInvoice',
      params: { dueDate: '2025-05-15' },
    }));
    expect(res.status).toBe(400);
  });

  it('logs an expense via logExpense action', async () => {
    (mp.expense.create as any).mockResolvedValue({ id:'exp-new' });
    const res = await POST(req({
      action: 'logExpense',
      params: { description:'AWS Services', amount:15000, date:'2025-04-10' },
    }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
    expect(d.action).toBe('logExpense');
  });

  it('records revenue via recordRevenue action', async () => {
    (mp.revenue.create as any).mockResolvedValue({ id:'rev-new' });
    const res = await POST(req({
      action: 'recordRevenue',
      params: { amount:200000, type:'recurring', month:'2025-04-01' },
    }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
  });

  it('returns 400 for recordRevenue without type', async () => {
    const res = await POST(req({
      action: 'recordRevenue',
      params: { amount:200000 },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown action', async () => {
    const res = await POST(req({ action: 'unknownAction', params: {} }));
    expect(res.status).toBe(400);
  });

  it('falls back to FounderOS token when tenant auth fails', async () => {
    mt.mockRejectedValue(new Error('no session'));
    (mp.expense.create as any).mockResolvedValue({ id:'exp-fos' });
    const res = await POST(req({
      action: 'logExpense',
      params: { description:'Via FOS Token', amount:5000 },
    }));
    expect(res.status).toBe(200);
  });

  it('returns 401 when both auth methods fail', async () => {
    mt.mockRejectedValue(new Error('no session'));
    const { extractFounderOSToken } = await import('@/lib/founder-os-jwt');
    vi.mocked(extractFounderOSToken).mockReturnValue(null as any);
    const res = await POST(req({ action: 'logExpense', params: { description:'X', amount:1 } }));
    expect(res.status).toBe(401);
  });
});
