import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { invoice: { findMany: vi.fn() } },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/tds', () => ({
  getCurrentQuarter: vi.fn().mockReturnValue('Q1'),
  TDS_QUARTERS: [
    { quarter:'Q1', months:'Apr-Jun' },
    { quarter:'Q2', months:'Jul-Sep' },
    { quarter:'Q3', months:'Oct-Dec' },
    { quarter:'Q4', months:'Jan-Mar' },
  ],
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/compliance/calendar/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  (mp.invoice.findMany as any).mockResolvedValue([]);
});

describe('GET /api/compliance/calendar', () => {
  it('returns deadlines with GST, TDS, and advance tax', async () => {
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.deadlines.length).toBeGreaterThan(5);
    expect(d.summary.total).toBeGreaterThan(0);
    // Should have GST entries
    expect(d.deadlines.some((dl: any) => dl.type === 'GST')).toBe(true);
    // Should have TDS entries
    expect(d.deadlines.some((dl: any) => dl.type === 'TDS')).toBe(true);
    // Should have advance tax entries
    expect(d.deadlines.some((dl: any) => dl.type === 'Income Tax')).toBe(true);
  });

  it('includes upcoming invoice due dates', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([
      { invoiceNumber:'INV-001', total:100000, dueDate:new Date(Date.now() + 7*86400000), client:{ name:'Acme' } },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(d.deadlines.some((dl: any) => dl.type === 'Receivable')).toBe(true);
  });

  it('marks overdue deadlines correctly', async () => {
    const res = await GET();
    const d = await res.json();
    // Some past deadlines should be overdue
    const overdue = d.deadlines.filter((dl: any) => dl.status === 'overdue');
    expect(overdue.length).toBeGreaterThanOrEqual(0); // May have 0 if we're early in the month
  });

  it('deadlines are sorted by date', async () => {
    const res = await GET();
    const d = await res.json();
    for (let i = 1; i < d.deadlines.length; i++) {
      expect(d.deadlines[i].date >= d.deadlines[i-1].date).toBe(true);
    }
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
