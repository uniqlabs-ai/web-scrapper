import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(url: string): NextRequest { return new NextRequest(new URL(url), { method:'GET' }); }

// ── Expense Breakdown ──
describe('GET /api/expenses/breakdown', () => {
  let GET: any;
  beforeEach(async () => { ({ GET } = await import('@/app/api/expenses/breakdown/route')); });

  it('returns category breakdown with totals', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { amount:15000, vendor:'AWS', date:new Date('2025-04-01'), category:{ name:'SaaS', color:'#3b82f6' } },
      { amount:5000, vendor:'AWS', date:new Date('2025-04-05'), category:{ name:'SaaS', color:'#3b82f6' } },
      { amount:30000, vendor:'MakeMyTrip', date:new Date('2025-04-10'), category:{ name:'Travel', color:'#10b981' } },
    ]);
    const res = await GET(req('http://localhost:3008/api/expenses/breakdown'));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.byCategory).toHaveLength(2);
    expect(d.byCategory[0].name).toBe('Travel'); // higher total
    expect(d.grandTotal).toBe(50000);
    expect(d.count).toBe(3);
  });

  it('returns vendor breakdown', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { amount:10000, vendor:'AWS', date:new Date(), category:{ name:'SaaS', color:'#3b82f6' } },
    ]);
    const res = await GET(req('http://localhost:3008/api/expenses/breakdown'));
    const d = await res.json();
    expect(d.byVendor.length).toBeGreaterThanOrEqual(1);
    expect(d.byVendor[0].name).toBe('AWS');
  });

  it('handles empty expenses', async () => {
    (mp.expense.findMany as any).mockResolvedValue([]);
    const res = await GET(req('http://localhost:3008/api/expenses/breakdown'));
    const d = await res.json();
    expect(d.grandTotal).toBe(0);
    expect(d.byCategory).toHaveLength(0);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req('http://localhost:3008/api/expenses/breakdown'));
    expect(res.status).toBe(500);
  });
});

// ── Reports: Aging ──
describe('GET /api/reports/aging', () => {
  let AGING: any;
  beforeEach(async () => { ({ GET: AGING } = await import('@/app/api/reports/aging/route')); });

  it('returns receivable aging with buckets', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([
      {
        id:'inv-1', invoiceNumber:'INV-001', total:100000, status:'sent',
        issueDate:new Date('2025-03-01'), dueDate:new Date(Date.now() + 7*86400000),
        client:{ name:'Acme', company:'Acme Corp' },
        payments:[],
      },
      {
        id:'inv-2', invoiceNumber:'INV-002', total:50000, status:'overdue',
        issueDate:new Date('2025-01-01'), dueDate:new Date('2025-02-01'),
        client:{ name:'Old Client', company:null },
        payments:[{ amount:10000 }],
      },
    ]);
    const res = await AGING(req('http://localhost:3008/api/reports/aging'));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.type).toBe('receivable');
    expect(d.buckets).toBeDefined();
    expect(d.totalOutstanding).toBeGreaterThan(0);
    expect(d.invoiceCount).toBe(2);
  });

  it('returns payable aging', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { id:'exp-1', amount:50000, date:new Date(), description:'AWS', vendor:'AWS', category:{ name:'SaaS' } },
    ]);
    const res = await AGING(req('http://localhost:3008/api/reports/aging?type=payable'));
    const d = await res.json();
    expect(d.type).toBe('payable');
    expect(d.totalPayable).toBe(50000);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await AGING(req('http://localhost:3008/api/reports/aging'));
    expect(res.status).toBe(500);
  });
});
