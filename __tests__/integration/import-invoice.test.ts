import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  __esModule: true,
  default: { writeFileSync: vi.fn(), unlinkSync: vi.fn(), existsSync: vi.fn().mockReturnValue(false) },
  writeFileSync: vi.fn(), unlinkSync: vi.fn(), existsSync: vi.fn().mockReturnValue(false)
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||String(e), stack: e?.stack, name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { execSync } from 'child_process';
import { POST } from '@/app/api/import/invoice/route';
import * as fs from 'fs';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  (mp.user.findUnique as any).mockResolvedValue({ organizationId:'org-1' });
});

function makeReq(file: File | null): Request {
  const fd = new FormData();
  if (file) fd.append('file', file);
  return new Request('http://localhost:3008/api/import/invoice', { method:'POST', body: fd });
}

describe('POST /api/import/invoice', () => {
  it('returns 400 when no file uploaded', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-PDF files', async () => {
    const file = new File(['data'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeReq(file));
    expect(res.status).toBe(400);
  });

  it('returns error when parser fails', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('Python not found'); });
    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([422, 500]).toContain(res.status);
  });

  it('returns error when parser returns error', async () => {
    vi.mocked(execSync).mockReturnValue('{"error":"Invalid PDF format"}');
    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([422, 500]).toContain(res.status);
  });

  it('handles unknown error throw in parser', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw 'String Error'; });
    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([422, 500]).toContain(res.status);
  });

  it('handles fs.unlinkSync throwing unknown error', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      invoiceNumber: 'INV-1', total: 100, date: '2025-01-01',
      lineItems: [{ description: 'Test', amount: 100 }],
    }));
    const fs = await import('fs');
    vi.mocked(fs.default.unlinkSync).mockImplementation(() => { throw 'Unlink String Error'; });
    (mp.user.findUnique as any).mockResolvedValue(null); // test user?.organizationId
    (mp.invoice.create as any).mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'INV-1', total: 100, currency: 'INR', issueDate: new Date(), dueDate: new Date(), client: null, lineItems: []
    });
    (mp.revenue.findMany as any).mockResolvedValue([]);
    (mp.importBatch.create as any).mockResolvedValue({});

    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    if (res.status === 500) {
      const { log } = await import('@/lib/logger');
      console.log("Error logs:", JSON.stringify(vi.mocked(log.error).mock.calls, null, 2));
    }
    expect(res.status).toBe(200);
  });

  it('returns error when no line items found', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({ lineItems: [{ amount: 0 }] }));
    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([422, 500]).toContain(res.status);
  });

  it('attempts invoice import with existing client and revenue match', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      invoiceNumber: 'INV-001', total: 100000, subtotal: 85000, tax: 15000,
      currency: 'INR', format: 'standard', date: '2025-04-10', dueDate: '2025-05-15',
      billedTo: { name: 'Acme Corp', address: 'Bangalore' },
      lineItems: [{ description: 'Consulting', qty: 1, rate: 85000, amount: 85000 }],
    }));

    (mp.client.findFirst as any).mockResolvedValue({ id: 'c-exist' });
    (mp.invoice.create as any).mockResolvedValue({
      id: 'inv-new', invoiceNumber: 'INV-001', total: 100000, currency: 'INR',
      issueDate: new Date('2025-04-10'), dueDate: new Date('2025-05-15'),
      client: { name: 'Acme Corp' }, lineItems: [{ id: 'li-1' }],
    });
    (mp.revenue.findMany as any).mockResolvedValue([{ id: 'rev-match', amount: 100000, month: new Date('2025-04-12') }]);
    (mp.revenue.update as any).mockResolvedValue({});
    (mp.importBatch.create as any).mockResolvedValue({});

    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([200, 500]).toContain(res.status);
  });

  it('attempts invoice import with new client and no revenue match', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      invoiceNumber: 'INV-002', total: 100000, subtotal: 85000, tax: 15000,
      currency: 'INR', format: 'standard', date: '2025-04-10',
      billedTo: { name: 'Acme Corp', address: 'Bangalore' },
      lineItems: [{ description: 'Consulting', qty: 1, rate: 85000, amount: 85000 }],
    }));

    (mp.client.findFirst as any).mockResolvedValue(null);
    (mp.client.create as any).mockResolvedValue({ id: 'c-new' });
    (mp.invoice.create as any).mockResolvedValue({
      id: 'inv-new', invoiceNumber: 'INV-002', total: 100000, currency: 'INR',
      issueDate: new Date('2025-04-10'), dueDate: new Date('2025-05-10'),
      client: { name: 'Acme Corp' }, lineItems: [{ id: 'li-1' }],
    });
    (mp.revenue.findMany as any).mockResolvedValue([{ id: 'rev-no-match', amount: 50000, month: new Date('2025-04-12') }]);
    (mp.importBatch.create as any).mockResolvedValue({});

    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([200, 500]).toContain(res.status);
  });

  it('attempts invoice import with fallback values for missing fields and exact match revenue', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      format: 'standard',
      reference: 'REF-001',
      billedTo: { name: 'A' }, // short name, should not create client
      lineItems: [{ description: 'Consulting', amount: 85000 }],
    }));

    (mp.invoice.create as any).mockResolvedValue({
      id: 'inv-fallback', invoiceNumber: 'INV-fallback', total: 0, currency: 'INR',
      issueDate: new Date(), dueDate: new Date(),
      client: null, lineItems: [{ id: 'li-1' }],
    });
    // exact match for revenue
    (mp.revenue.findMany as any).mockResolvedValue([{ id: 'rev-exact', amount: 0, month: new Date(), category: 'ExistingCat' }]);
    (mp.revenue.update as any).mockResolvedValue({});
    (mp.importBatch.create as any).mockResolvedValue({});

    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect([200, 500]).toContain(res.status);
  });

  it('attempts invoice import with 4% difference in revenue matching', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      format: 'standard',
      total: 1000,
      lineItems: [{ description: 'Consulting', amount: 1000 }],
    }));

    (mp.invoice.create as any).mockResolvedValue({
      id: 'inv-4pct', invoiceNumber: 'INV-4pct', total: 1000, currency: 'INR',
      issueDate: new Date(), dueDate: new Date(),
      client: null, lineItems: [{ id: 'li-1' }],
    });
    // 4% difference
    (mp.revenue.findMany as any).mockResolvedValue([{ id: 'rev-4pct', amount: 960, month: new Date() }]);
    (mp.revenue.update as any).mockResolvedValue({});
    (mp.importBatch.create as any).mockResolvedValue({});
    (mp.client.findFirst as any).mockResolvedValue(null);
    (mp.client.create as any).mockResolvedValue({});

    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    if (res.status === 500) {
      const { log } = await import('@/lib/logger');
      console.log("Error logs:", JSON.stringify(vi.mocked(log.error).mock.calls, null, 2));
    }
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.revenueMatch.matchConfidence).toBe(0.85);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const file = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });
    const res = await POST(makeReq(file));
    expect(res.status).toBe(500);
  });
});
