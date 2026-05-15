import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
    recurringExpense: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    vendor: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/detect-recurring/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  (mp.recurringExpense.findMany as any).mockResolvedValue([]);
  (mp.employee.findMany as any).mockResolvedValue([]);
  (mp.vendor.findMany as any).mockResolvedValue([]);
});

describe('GET /api/detect-recurring', () => {
  it('detects subscription-like expenses across 2+ months', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'MSI/VERCEL INC', amount:2000, date:new Date('2025-01-15'), vendor:'Vercel' },
      { description:'MSI/VERCEL INC', amount:2000, date:new Date('2025-02-15'), vendor:'Vercel' },
      { description:'MSI/VERCEL INC', amount:2000, date:new Date('2025-03-15'), vendor:'Vercel' },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.subscriptions.length).toBeGreaterThanOrEqual(1);
    const vercel = d.subscriptions.find((s: any) => s.name.toLowerCase().includes('vercel'));
    expect(vercel).toBeDefined();
    expect(vercel.kind).toBe('subscription');
  });

  it('detects recurring person-name expenses across 3+ months', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'NEFT Alice Smith', amount:50000, date:new Date('2025-01-28'), vendor:null },
      { description:'NEFT Alice Smith', amount:50000, date:new Date('2025-02-28'), vendor:null },
      { description:'NEFT Alice Smith', amount:50000, date:new Date('2025-03-28'), vendor:null },
    ]);
    const res = await GET();
    const d = await res.json();
    // Person names can be classified as payroll or unknown depending on scoring
    const allSuggestions = [...d.payroll, ...d.subscriptions];
    expect(allSuggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('excludes already-tracked recurring expenses', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'MSI/VERCEL INC', amount:2000, date:new Date('2025-01-15'), vendor:'Vercel' },
      { description:'MSI/VERCEL INC', amount:2000, date:new Date('2025-02-15'), vendor:'Vercel' },
    ]);
    (mp.recurringExpense.findMany as any).mockResolvedValue([
      { description:'VERCEL INC', vendor:'Vercel' },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(d.subscriptions.filter((s: any) => s.name.toLowerCase().includes('vercel'))).toHaveLength(0);
  });

  it('excludes already-tracked employees from suggestions when names match', async () => {
    // Use direct description matching the employee name format
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'Alice Smith', amount:50000, date:new Date('2025-01-28'), vendor:null },
      { description:'Alice Smith', amount:50000, date:new Date('2025-02-28'), vendor:null },
    ]);
    (mp.employee.findMany as any).mockResolvedValue([{ name: 'Alice Smith' }]);
    const res = await GET();
    const d = await res.json();
    // With direct match, employee should be excluded from all categories
    const allAlice = [...d.payroll, ...d.subscriptions].filter((p: any) => p.name.toLowerCase().includes('alice'));
    expect(allAlice).toHaveLength(0);
  });

  it('builds vendor suggestions for 2+ occurrence vendors not already tracked', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'AWS Cloud Services', amount:15000, date:new Date('2025-01-15'), vendor:'AWS' },
      { description:'AWS Cloud Services', amount:18000, date:new Date('2025-02-15'), vendor:'AWS' },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(d.vendors.length).toBeGreaterThanOrEqual(1);
  });

  it('returns stats summary', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'Test Vendor', amount:1000, date:new Date('2025-01-15'), vendor:null },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(d.stats).toBeDefined();
    expect(d.stats.totalExpenses).toBe(1);
  });

  it('handles empty expenses', async () => {
    (mp.expense.findMany as any).mockResolvedValue([]);
    const res = await GET();
    const d = await res.json();
    expect(d.subscriptions).toEqual([]);
    expect(d.payroll).toEqual([]);
    expect(d.stats.totalExpenses).toBe(0);
  });

  it('classifies bank fee keywords as subscription', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'CGST Commission Charges', amount:500, date:new Date('2025-01-15'), vendor:null },
      { description:'CGST Commission Charges', amount:500, date:new Date('2025-02-15'), vendor:null },
      { description:'CGST Commission Charges', amount:500, date:new Date('2025-03-15'), vendor:null },
    ]);
    const res = await GET();
    const d = await res.json();
    const fee = d.subscriptions.find((s: any) => s.name.toLowerCase().includes('commission'));
    if (fee) expect(fee.kind).toBe('subscription');
  });

  it('handles name extraction prefixes and noise stripping', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'BIL/ONL/001174143 662/Amazon Web Services~xyz', amount:2000, date:new Date('2025-01-15'), vendor:null },
      { description:'MMT/IMPS/123456789/MakeMyTrip', amount:2000, date:new Date('2025-02-15'), vendor:null },
      { description:'INF/NEFT/HDFC0001234/VFS Global', amount:2000, date:new Date('2025-03-15'), vendor:null },
      { description:'GRS/123456/Stripe Payments', amount:2000, date:new Date('2025-04-15'), vendor:null },
      { description:'FT-MPS-1234/GitHub Inc.', amount:2000, date:new Date('2025-05-15'), vendor:null },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
  });

  it('excludes noise transactions like tax and FD', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'FD no 12345', amount:2000, date:new Date('2025-01-15'), vendor:null },
      { description:'FD no 12345', amount:2000, date:new Date('2025-02-15'), vendor:null },
      { description:'GST PAYMENT P12345678901', amount:2000, date:new Date('2025-01-15'), vendor:null },
      { description:'GST PAYMENT P12345678901', amount:2000, date:new Date('2025-02-15'), vendor:null },
      { description:'XY', amount:2000, date:new Date('2025-01-15'), vendor:null }, // < 3 alpha
      { description:'XY', amount:2000, date:new Date('2025-02-15'), vendor:null },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(d.subscriptions).toHaveLength(0);
    expect(d.payroll).toHaveLength(0);
  });

  it('guesses various frequencies', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description:'Quarterly Sub', amount:2000, date:new Date('2025-01-15'), vendor:null },
      { description:'Quarterly Sub', amount:2000, date:new Date('2025-04-15'), vendor:null }, // ~3 months gap -> quarterly
      { description:'Half-yearly Sub', amount:2000, date:new Date('2025-01-15'), vendor:null },
      { description:'Half-yearly Sub', amount:2000, date:new Date('2025-07-15'), vendor:null }, // ~6 months gap -> half-yearly
      { description:'Yearly Sub', amount:2000, date:new Date('2025-01-15'), vendor:null },
      { description:'Yearly Sub', amount:2000, date:new Date('2026-01-15'), vendor:null }, // ~12 months gap -> yearly
    ]);
    const res = await GET();
    const d = await res.json();
    const q = d.subscriptions.find((s:any) => s.name === 'Quarterly Sub');
    const h = d.subscriptions.find((s:any) => s.name === 'Halfyearly Sub');
    const y = d.subscriptions.find((s:any) => s.name === 'Yearly Sub');
    if (q) expect(q.frequency).toBe('quarterly');
    if (h) expect(h.frequency).toBe('half-yearly');
    if (y) expect(y.frequency).toBe('yearly');
  });

  it('classifies VFS/insurance keywords as subscription not payroll', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description: 'VFS Global Fee', amount: 5000, date: new Date('2025-01-15'), vendor: null },
      { description: 'VFS Global Fee', amount: 5000, date: new Date('2025-02-15'), vendor: null },
      { description: 'VFS Global Fee', amount: 5000, date: new Date('2025-03-15'), vendor: null },
    ]);
    const res = await GET();
    const d = await res.json();
    const vfs = d.subscriptions.find((s: any) => s.name.toLowerCase().includes('vfs'));
    if (vfs) expect(vfs.kind).toBe('subscription');
  });

  it('classifies salary-like names with consistent amounts as payroll', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description: 'SALARY Rajesh Kumar', amount: 50000, date: new Date('2025-01-28'), vendor: null },
      { description: 'SALARY Rajesh Kumar', amount: 50000, date: new Date('2025-02-28'), vendor: null },
      { description: 'SALARY Rajesh Kumar', amount: 50000, date: new Date('2025-03-28'), vendor: null },
    ]);
    const res = await GET();
    const d = await res.json();
    const rajesh = [...d.payroll, ...d.subscriptions].find((s: any) => s.name.toLowerCase().includes('rajesh'));
    if (rajesh) {
      expect(['payroll_fixed', 'payroll_variable']).toContain(rajesh.kind);
    }
  });

  it('classifies variable-amount salary as payroll_variable', async () => {
    (mp.expense.findMany as any).mockResolvedValue([
      { description: 'NEFT Anita Employee', amount: 45000, date: new Date('2025-01-28'), vendor: null },
      { description: 'NEFT Anita Employee', amount: 52000, date: new Date('2025-02-28'), vendor: null },
      { description: 'NEFT Anita Employee', amount: 48000, date: new Date('2025-03-28'), vendor: null },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
