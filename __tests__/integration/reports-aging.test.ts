import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    expense: { findMany: vi.fn() }
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/reports/aging/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });

  (mp.invoice.findMany as any).mockResolvedValue([]);
  (mp.expense.findMany as any).mockResolvedValue([]);
});

function req(type?: string): NextRequest {
  const url = new URL('http://localhost:3008/api/reports/aging');
  if (type) url.searchParams.set('type', type);
  return new NextRequest(url);
}

describe('GET /api/reports/aging', () => {
  it('returns receivable report with different aging buckets', async () => {
    const now = new Date();
    const d0 = new Date(now.getTime() + 86400000); // Future (current)
    const d15 = new Date(now.getTime() - 15 * 86400000); // d1_30
    const d45 = new Date(now.getTime() - 45 * 86400000); // d31_60
    const d75 = new Date(now.getTime() - 75 * 86400000); // d61_90
    const d100 = new Date(now.getTime() - 100 * 86400000); // d90_plus

    (mp.invoice.findMany as any).mockResolvedValue([
      { id: '1', invoiceNumber: 'INV-1', total: 1000, dueDate: d0, issueDate: d0, status: 'sent', payments: [] },
      { id: '2', invoiceNumber: 'INV-2', total: 2000, dueDate: d15, issueDate: d15, status: 'overdue', payments: [{ amount: 500 }] },
      { id: '3', invoiceNumber: 'INV-3', total: 3000, dueDate: d45, issueDate: d45, status: 'overdue', payments: [], client: { name: 'Acme' } },
      { id: '4', invoiceNumber: 'INV-4', total: 4000, dueDate: d75, issueDate: d75, status: 'overdue', payments: [] },
      { id: '5', invoiceNumber: 'INV-5', total: 5000, dueDate: d100, issueDate: d100, status: 'overdue', payments: [] },
    ]);

    const res = await GET(req('receivable'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.type).toBe('receivable');
    expect(data.buckets.current).toBe(1000);
    expect(data.buckets.d1_30).toBe(1500); // 2000 - 500
    expect(data.buckets.d31_60).toBe(3000);
    expect(data.buckets.d61_90).toBe(4000);
    expect(data.buckets.d90_plus).toBe(5000);
    expect(data.totalOutstanding).toBe(14500);
  });

  it('returns payable report', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { id: '1', amount: 500, description: 'AWS', date: new Date(), vendor: 'Amazon', category: { name: 'Software' } }
    ]);

    const res = await GET(req('payable'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.type).toBe('payable');
    expect(data.totalPayable).toBe(500);
    expect(data.items.length).toBe(1);
    expect(data.items[0].category).toBe('Software');
  });

  it('defaults to receivable if type is not provided', async () => {
    await GET(req());
    expect(mp.invoice.findMany).toHaveBeenCalled();
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
