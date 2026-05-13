import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: vi.fn(), findMany: vi.fn() },
    organization: { findFirst: vi.fn() },
    expense: { findMany: vi.fn() },
    revenue: { findMany: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function req(url: string): NextRequest { return new NextRequest(new URL(url), { method:'GET' }); }

describe('GET /api/gst/einvoice', () => {
  let GET_EINV: any;
  beforeEach(async () => { ({ GET: GET_EINV } = await import('@/app/api/gst/einvoice/route')); });

  it('generates e-invoice JSON', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue({
      id:'inv-1', invoiceNumber:'INV-001', subtotal:100000, total:118000,
      issueDate:new Date('2025-04-10'), isInterState:false, placeOfSupply:'29-Karnataka',
      client:{ name:'Acme', gstNumber:'29AABCU1234F1Z5', company:'Acme', address:'Bangalore' },
      lineItems:[{ description:'Consulting', quantity:1, rate:100000, amount:100000, cgst:9000, sgst:9000, igst:0, hsnCode:'998311' }],
    });
    (mp.organization.findFirst as any).mockResolvedValue({ name:'MyCompany', gstNumber:'29XXXXX1234X1Z5', address:'HSR' });
    const res = await GET_EINV(req('http://localhost:3008/api/gst/einvoice?invoiceId=inv-1'));
    expect(res.status).toBe(200);
  });

  it('returns 400 without invoiceId', async () => {
    const res = await GET_EINV(req('http://localhost:3008/api/gst/einvoice'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    (mp.invoice.findFirst as any).mockResolvedValue(null);
    const res = await GET_EINV(req('http://localhost:3008/api/gst/einvoice?invoiceId=x'));
    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET_EINV(req('http://localhost:3008/api/gst/einvoice?invoiceId=x'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/tds/form16a', () => {
  let GET_FORM: any;
  beforeEach(async () => { ({ GET: GET_FORM } = await import('@/app/api/tds/form16a/route')); });

  it('generates Form 16A data', async () => {
    (mp.organization.findFirst as any).mockResolvedValue({ name:'MyCompany', gstNumber:'29AAAAA0001A1Z5' });
    (mp.expense.findMany as any).mockResolvedValue([
      { vendor:'Acme', amount:100000, tdsAmount:10000, tdsRate:10, date:new Date('2025-04-15'), tdsSection:'194C', category:{ name:'Fees' } },
    ]);
    const res = await GET_FORM(req('http://localhost:3008/api/tds/form16a?quarter=Q1&fy=2025-2026'));
    expect(res.status).toBe(200);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET_FORM(req('http://localhost:3008/api/tds/form16a'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/reports/cfo-brief', () => {
  let GET_CFO: any;
  beforeEach(async () => {
    ({ GET: GET_CFO } = await import('@/app/api/reports/cfo-brief/route'));
    (mp.expense.findMany as any).mockResolvedValue([
      { amount:50000, date:new Date(), category:{ name:'SaaS' } },
    ]);
    (mp.revenue.findMany as any).mockResolvedValue([
      { amount:200000, month:new Date() },
    ]);
    (mp.invoice.findMany as any).mockResolvedValue([
      { total:100000, status:'sent', dueDate:new Date(Date.now() - 5*86400000), payments:[] },
    ]);
    (mp.bankAccount.findMany as any).mockResolvedValue([
      { currentBalance:1000000, currency:'INR' },
    ]);
    (mp.user.findUnique as any).mockResolvedValue({
      name:'Nidish', organization:{ name:'MyCompany', currency:'INR' },
    });
  });

  it('returns CFO brief with financial data', async () => {
    const res = await GET_CFO();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.weekSummary).toBeDefined();
    expect(d.cashPosition).toBeDefined();
    expect(d.profitability).toBeDefined();
    expect(d.companyName).toBe('MyCompany');
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET_CFO();
    expect(res.status).toBe(500);
  });
});
