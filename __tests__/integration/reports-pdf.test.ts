import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    revenue: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/currency', () => ({ formatCurrency: vi.fn((n: number) => `₹${n.toLocaleString()}`) }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/reports/pdf/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function req(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3008/api/reports/pdf');
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe('GET /api/reports/pdf', () => {
  it('generates invoice PDF HTML', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id:'inv-1', invoiceNumber:'INV-001', issueDate:new Date('2025-04-01'),
      dueDate:new Date('2025-05-01'), status:'sent', subtotal:10000, taxTotal:1800, total:11800,
      notes:'Please pay promptly',
      client:{ name:'Acme', company:'Acme Inc', gstNumber:'29AABCU1234F1Z5' },
      lineItems:[{ description:'Consulting', quantity:1, unitPrice:10000, amount:10000, cgst:900, sgst:900, igst:0 }],
    });
    (mp.organization.findFirst as any).mockResolvedValue({ name:'MyCompany', gstNumber:'29XXX' });

    const res = await GET(req({ type:'invoice', invoiceId:'inv-1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('INV-001');
    expect(html).toContain('Acme');
  });

  it('returns 404 for unknown invoice', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue(null);
    const res = await GET(req({ type:'invoice', invoiceId:'inv-missing' }));
    expect(res.status).toBe(404);
  });

  it('generates invoice PDF HTML for paid status without notes and GST', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id:'inv-2', invoiceNumber:'INV-002', issueDate:new Date('2025-04-01'),
      dueDate:new Date('2025-05-01'), status:'paid', subtotal:10000, taxTotal:1800, total:11800,
      notes:null,
      client:{ name:'Acme', company:'Acme Inc', gstNumber:null },
      lineItems:[{ description:'Consulting', quantity:1, unitPrice:10000, amount:10000, cgst:900, sgst:900, igst:0 }],
    });
    (mp.organization.findFirst as any).mockResolvedValue({ name:'MyCompany', gstNumber:null });

    const res = await GET(req({ type:'invoice', invoiceId:'inv-2' }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('PAID');
    expect(html).not.toContain('GSTIN:');
  });

  it('generates P&L PDF HTML with net profit', async () => {
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount: 100000, month: new Date('2025-04-01') },
    ]);
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 30000, date: new Date('2025-04-05'), category: { name: 'SaaS' } },
      { amount: 10000, date: new Date('2025-04-10'), category: null },
    ]);

    const res = await GET(req({ type:'pnl', from:'2025-04-01', to:'2025-04-30' }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Profit');
    expect(html).toContain('Revenue');
  });

  it('generates P&L with default dates and net loss', async () => {
    (mp.revenue.findMany as any).mockResolvedValue([]);
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 50000, date: new Date(), category: null }
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Loss');
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
