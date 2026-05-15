import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankTransaction: { findMany: vi.fn() },
    vendor: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    recurringExpense: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/suggestions/aliases/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });

  (mp.bankTransaction.findMany as any).mockResolvedValue([]);
  (mp.vendor.findMany as any).mockResolvedValue([]);
  (mp.employee.findMany as any).mockResolvedValue([]);
  (mp.client.findMany as any).mockResolvedValue([]);
  (mp.recurringExpense.findMany as any).mockResolvedValue([]);
  (mp.expense.findMany as any).mockResolvedValue([]);
});

function req(type: string = 'all', q: string = ''): NextRequest {
  let url = `http://localhost:3008/api/suggestions/aliases?type=${type}`;
  if (q) url += `&q=${q}`;
  return new NextRequest(new URL(url));
}

describe('GET /api/suggestions/aliases', () => {
  it('returns all types when type=all', async () => {
    (mp.bankTransaction.findMany as any).mockResolvedValue([{ description: 'Bank Txn 1' }, { description: 'Bank Txn 1' }, { description: ' ' }]);
    (mp.vendor.findMany as any).mockResolvedValue([{ name: 'Vendor 1' }]);
    (mp.employee.findMany as any).mockResolvedValue([{ name: 'Employee 1' }]);
    (mp.client.findMany as any).mockResolvedValue([{ name: 'Client 1' }]);
    (mp.recurringExpense.findMany as any).mockResolvedValue([{ description: 'Recurring 1' }]);
    (mp.expense.findMany as any).mockResolvedValue([{ description: 'Expense 1' }]);

    const res = await GET(req('all'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.suggestions).toEqual(expect.arrayContaining([
      { label: 'Vendor 1', source: 'vendor' },
      { label: 'Employee 1', source: 'payroll' },
      { label: 'Client 1', source: 'client' },
      { label: 'Recurring 1', source: 'recurring' },
      { label: 'Bank Txn 1', source: 'bank' },
      { label: 'Expense 1', source: 'expense' }
    ]));
    // Deduplication check: 'Bank Txn 1' appears once
    expect(data.suggestions.filter((s: any) => s.label === 'Bank Txn 1').length).toBe(1);
  });

  it('filters by vendor type', async () => {
    (mp.vendor.findMany as any).mockResolvedValue([{ name: 'Vendor 1' }]);
    (mp.employee.findMany as any).mockResolvedValue([{ name: 'Employee 1' }]);

    const res = await GET(req('vendor'));
    const data = await res.json();
    
    expect(data.suggestions).toEqual(expect.arrayContaining([{ label: 'Vendor 1', source: 'vendor' }]));
    expect(data.suggestions.find((s: any) => s.source === 'payroll')).toBeUndefined();
  });

  it('filters by payroll type', async () => {
    (mp.employee.findMany as any).mockResolvedValue([{ name: 'Employee 1' }]);
    
    const res = await GET(req('payroll'));
    const data = await res.json();
    
    expect(data.suggestions).toEqual(expect.arrayContaining([{ label: 'Employee 1', source: 'payroll' }]));
  });

  it('filters by client type', async () => {
    (mp.client.findMany as any).mockResolvedValue([{ name: 'Client 1' }]);
    
    const res = await GET(req('client'));
    const data = await res.json();
    
    expect(data.suggestions).toEqual(expect.arrayContaining([{ label: 'Client 1', source: 'client' }]));
  });

  it('filters by recurring type', async () => {
    (mp.recurringExpense.findMany as any).mockResolvedValue([{ description: 'Recurring 1' }]);
    
    const res = await GET(req('recurring'));
    const data = await res.json();
    
    expect(data.suggestions).toEqual(expect.arrayContaining([{ label: 'Recurring 1', source: 'recurring' }]));
  });

  it('passes search query to findMany calls', async () => {
    await GET(req('all', 'searchterm'));
    
    expect(mp.bankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ description: { contains: 'searchterm', mode: 'insensitive' } })
    }));
    expect(mp.vendor.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ name: { contains: 'searchterm', mode: 'insensitive' } })
    }));
  });

  it('deduplicates across sources', async () => {
    (mp.vendor.findMany as any).mockResolvedValue([{ name: 'Duplicate Name' }]);
    (mp.employee.findMany as any).mockResolvedValue([{ name: 'Duplicate Name' }]);
    (mp.bankTransaction.findMany as any).mockResolvedValue([{ description: 'Duplicate Name' }]);
    
    const res = await GET(req('all'));
    const data = await res.json();
    
    const duplicates = data.suggestions.filter((s: any) => s.label === 'Duplicate Name');
    expect(duplicates.length).toBe(1);
    expect(duplicates[0].source).toBe('bank'); // Priority is bank since it's processed first
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
