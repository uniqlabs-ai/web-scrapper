import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    client: { findFirst: vi.fn(), create: vi.fn() },
    invoice: { create: vi.fn() },
    revenue: { findMany: vi.fn(), update: vi.fn() },
    importBatch: { create: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

// Mock file system and child process
vi.mock('fs', () => ({ default: { writeFileSync: vi.fn(), unlinkSync: vi.fn() } }));
vi.mock('child_process', () => ({ execSync: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/import/invoice/route';
import { mockPrisma } from '../helpers/prisma-mock';
import { execSync } from 'child_process';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const mExec = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mp.user.findUnique.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
  mp.revenue.findMany.mockResolvedValue([]);
});

function makeReq(fileName: string | null): NextRequest {
  const form = new FormData();
  if (fileName) {
    const file = new File(['fake-pdf'], fileName, { type: 'application/pdf' });
    form.append('file', file);
  }
  return new NextRequest(new URL('http://localhost:3008/api/import/invoice'), {
    method: 'POST',
    body: form,
  } as Record<string, unknown>);
}

describe('POST /api/import/invoice', () => {
  it('returns 400 when no file is uploaded', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 when file is not PDF', async () => {
    const res = await POST(makeReq('image.png'));
    expect(res.status).toBe(400);
  });

  it('returns 422 on parse error from python script', async () => {
    mExec.mockImplementation(() => { throw new Error('Crash'); });
    const res = await POST(makeReq('invoice.pdf'));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('Failed to parse invoice');
  });

  it('returns 422 if script returns parsed.error', async () => {
    mExec.mockReturnValue(JSON.stringify({ error: 'Invalid format' }));
    const res = await POST(makeReq('invoice.pdf'));
    expect(res.status).toBe(422);
  });

  it('returns 422 if no non-zero line items exist', async () => {
    mExec.mockReturnValue(JSON.stringify({
      lineItems: [{ amount: 0 }]
    }));
    const res = await POST(makeReq('invoice.pdf'));
    expect(res.status).toBe(422);
  });

  it('creates invoice and upserts new client', async () => {
    mExec.mockReturnValue(JSON.stringify({
      reference: 'INV-100', total: 1000,
      billedTo: { name: 'New Client Corp', address: '123 St' },
      lineItems: [{ description: 'Dev', qty: 1, rate: 1000, amount: 1000 }]
    }));
    
    mp.client.findFirst.mockResolvedValue(null);
    mp.client.create.mockResolvedValue({ id: 'client-1' } as any);
    mp.invoice.create.mockResolvedValue({ id: 'inv-1', lineItems: [{}] } as any);

    const res = await POST(makeReq('invoice.pdf'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mp.client.create).toHaveBeenCalled();
    expect(mp.invoice.create).toHaveBeenCalled();
  });

  it('creates invoice using existing client', async () => {
    mExec.mockReturnValue(JSON.stringify({
      total: 1000,
      billedTo: { name: 'Existing Client' },
      lineItems: [{ description: 'Dev', amount: 1000 }]
    }));
    
    mp.client.findFirst.mockResolvedValue({ id: 'client-existing' } as any);
    mp.invoice.create.mockResolvedValue({ id: 'inv-1', lineItems: [{}] } as any);

    await POST(makeReq('invoice.pdf'));
    expect(mp.client.create).not.toHaveBeenCalled();
    expect(mp.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientId: 'client-existing' })
    }));
  });

  it('smart matches against existing revenue entries', async () => {
    mExec.mockReturnValue(JSON.stringify({
      total: 1000,
      lineItems: [{ description: 'Dev', amount: 1000 }]
    }));
    
    mp.invoice.create.mockResolvedValue({ id: 'inv-1', lineItems: [{}] } as any);
    mp.revenue.findMany.mockResolvedValue([
      { id: 'rev-1', amount: 1000, month: new Date() }
    ] as any);

    const res = await POST(makeReq('invoice.pdf'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.revenueMatch.revenueId).toBe('rev-1');
    expect(mp.revenue.update).toHaveBeenCalled();
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq('invoice.pdf'));
    expect(res.status).toBe(500);
  });
});
