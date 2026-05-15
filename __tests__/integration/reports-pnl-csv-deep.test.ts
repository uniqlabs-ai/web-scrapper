import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/financial-intelligence', () => ({ generatePnL: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { requireTenant } from '@/lib/tenant';
import { generatePnL } from '@/lib/financial-intelligence';
import { GET } from '@/app/api/reports/pnl/csv/route';

const mt = vi.mocked(requireTenant);
const mg = vi.mocked(generatePnL);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('GET /api/reports/pnl/csv', () => {
  function makeReq(from?: string, to?: string): NextRequest {
    const url = new URL('http://localhost:3008/api/reports/pnl/csv');
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    return new NextRequest(url, { method: 'GET' });
  }

  it('generates CSV correctly with provided dates', async () => {
    mg.mockResolvedValue({
      revenue: [{ label: 'Sales', amount: 1000 }],
      totalRevenue: 1000,
      expenses: [{ label: 'Rent', amount: 500 }],
      totalExpenses: 500,
      netIncome: 500,
      profitMargin: 50
    });

    const res = await GET(makeReq('2024-01-01', '2024-01-31'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    
    const csv = await res.text();
    expect(csv).toContain('"Sales",Revenue,1000.00');
    expect(csv).toContain('"Rent",Expense,500.00');
    expect(csv).toContain('"Net Income",,500.00');
  });

  it('uses default dates if not provided', async () => {
    mg.mockResolvedValue({
      revenue: [], totalRevenue: 0,
      expenses: [], totalExpenses: 0,
      netIncome: 0, profitMargin: 0
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('"Total Revenue",Revenue,0.00');
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });
});
