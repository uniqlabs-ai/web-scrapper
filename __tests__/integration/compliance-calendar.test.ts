import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/compliance/calendar/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  (mp.invoice.findMany as any).mockResolvedValue([]);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/compliance/calendar', () => {
  it('handles mid-year dates correctly (August 11th)', async () => {
    vi.setSystemTime(new Date('2024-08-11T12:00:00Z')); // Today is GSTR-1 due date
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    
    expect(d.deadlines.some((dl: any) => dl.status === 'due_today' && dl.type === 'GST' && dl.date === '2024-08-11')).toBe(true);
    expect(d.deadlines.some((dl: any) => dl.status === 'overdue' && dl.type === 'TDS' && dl.date === '2024-07-31')).toBe(true);
    expect(d.deadlines.some((dl: any) => dl.status === 'upcoming' && dl.type === 'Income Tax' && dl.date === '2024-09-15')).toBe(true);
  });

  it('handles early-year dates correctly (January 20th)', async () => {
    vi.setSystemTime(new Date('2024-01-20T12:00:00Z')); // Today is GSTR-3B due date
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    
    expect(d.deadlines.some((dl: any) => dl.status === 'due_today' && dl.title.includes('GSTR-3B'))).toBe(true);
    
    // FY should be 2023 for early year
    expect(d.deadlines.some((dl: any) => dl.type === 'Income Tax' && dl.date === '2024-03-15')).toBe(true); // FY23 Q4 Advance tax
  });

  it('includes upcoming invoice due dates', async () => {
    vi.setSystemTime(new Date('2024-05-15T12:00:00Z'));
    (mp.invoice.findMany as any).mockResolvedValue([
      { invoiceNumber:'INV-001', total:100000, dueDate:new Date('2024-05-10T12:00:00Z'), client:{ name:'Acme' } }, // overdue
      { invoiceNumber:'INV-002', total:100000, dueDate:new Date('2024-05-15T12:00:00Z'), client:null }, // due_today
    ]);
    const res = await GET();
    const d = await res.json();
    
    expect(d.deadlines.some((dl: any) => dl.type === 'Receivable' && dl.status === 'overdue' && dl.title.includes('Acme'))).toBe(true);
    expect(d.deadlines.some((dl: any) => dl.type === 'Receivable' && dl.status === 'due_today' && dl.title.includes('Client'))).toBe(true);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
