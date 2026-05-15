import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    importBatch: { create: vi.fn(), update: vi.fn() },
    expense: { createMany: vi.fn() },
    revenue: { createMany: vi.fn() },
    invoice: { createMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/import/csv/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mp.user.findUnique.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
  mp.importBatch.create.mockResolvedValue({ id: 'batch1' } as any);
});

function makeReq(content: string, action: string, target: string, mapping?: any): NextRequest {
  const form = new FormData();
  if (content !== null) {
    const file = new File([content], 'data.csv', { type: 'text/csv' });
    form.append('file', file);
  }
  form.append('action', action);
  form.append('target', target);
  if (mapping) {
    form.append('mapping', JSON.stringify(mapping));
  }
  return new NextRequest(new URL('http://localhost:3008/api/import/csv'), {
    method: 'POST',
    body: form,
  } as Record<string, unknown>);
}

describe('POST /api/import/csv', () => {
  it('returns 400 when no file is uploaded', async () => {
    const form = new FormData();
    const req = new NextRequest(new URL('http://localhost:3008/api/import/csv'), { method: 'POST', body: form } as any);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid target', async () => {
    const res = await POST(makeReq('Col1\nVal1', 'detect', 'invalid_target'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty CSV', async () => {
    const res = await POST(makeReq('Col1,Col2\n', 'detect', 'expenses'));
    expect(res.status).toBe(400);
  });

  it('handles detect action for expenses', async () => {
    const csv = `Date,Description,Amount\n2025-06-01,Test,500\n`;
    const res = await POST(makeReq(csv, 'detect', 'expenses'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(data.mapping.date).toBe('Date');
    expect(data.mapping.amount).toBe('Amount');
  });

  it('handles preview action with validation errors', async () => {
    // Amount is invalid
    const csv = `Date,Description,Amount\n2025-06-01,Test,NotANumber\n`;
    const res = await POST(makeReq(csv, 'preview', 'expenses'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalRows).toBe(1);
    expect(data.errorCount).toBe(1);
    expect(data.preview[0]._errors).toBeDefined();
  });

  it('handles import action for expenses', async () => {
    const csv = `Date,Description,Amount\n2025-06-01,Test,500\n`;
    mp.expense.createMany.mockResolvedValue({ count: 1 } as any);

    const res = await POST(makeReq(csv, 'import', 'expenses'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.imported).toBe(1);
    expect(mp.expense.createMany).toHaveBeenCalled();
    expect(mp.importBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' })
    }));
  });

  it('handles import action for revenue', async () => {
    const csv = `Month,Amount,Source\n2025-06-01,5000,Client\n`;
    mp.revenue.createMany.mockResolvedValue({ count: 1 } as any);

    const res = await POST(makeReq(csv, 'import', 'revenue'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.imported).toBe(1);
    expect(mp.revenue.createMany).toHaveBeenCalled();
  });

  it('handles import action for invoices', async () => {
    const csv = `InvoiceNumber,Total,IssueDate\nINV-1,1000,2025-06-01\n`;
    mp.invoice.createMany.mockResolvedValue({ count: 1 } as any);

    const res = await POST(makeReq(csv, 'import', 'invoices'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.imported).toBe(1);
    expect(mp.invoice.createMany).toHaveBeenCalled();
  });

  it('marks batch as failed if bulk insert throws', async () => {
    const csv = `Date,Description,Amount\n2025-06-01,Test,500\n`;
    mp.expense.createMany.mockRejectedValue(new Error('DB error'));

    const res = await POST(makeReq(csv, 'import', 'expenses'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.failed).toBe(1);
    expect(mp.importBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' })
    }));
  });

  it('returns 400 for unknown action', async () => {
    const csv = `Date,Description,Amount\n2025-06-01,Test,500\n`;
    const res = await POST(makeReq(csv, 'unknown_action', 'expenses'));
    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected errors', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const csv = `Date,Description,Amount\n2025-06-01,Test,500\n`;
    const res = await POST(makeReq(csv, 'import', 'expenses'));
    expect(res.status).toBe(500);
  });
});
