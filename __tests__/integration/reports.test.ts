import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/financial-intelligence', () => ({ generatePnL: vi.fn(), projectCashFlow: vi.fn(), projectCashFlowOutlook: vi.fn(), calculateGSTSummary: vi.fn() }));

import { requireTenant } from '@/lib/tenant';
import { generatePnL, projectCashFlow, projectCashFlowOutlook, calculateGSTSummary } from '@/lib/financial-intelligence';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

function req(url: string): NextRequest { return new NextRequest(new URL(url)); }

describe('GET /api/reports/pnl', () => {
  let GET: any;
  beforeEach(async () => { GET = (await import('@/app/api/reports/pnl/route')).GET; });

  it('returns P&L report', async () => {
    vi.mocked(generatePnL).mockResolvedValue({ totalRevenue:500000, profitMargin:60, revenue:[{label:'R',amount:500000}], expenses:[{label:'E',amount:200000}] } as any);
    const res = await GET(req('http://localhost:3008/api/reports/pnl'));
    const d = await res.json();
    expect(res.status).toBe(200); expect(d.totalRevenue).toBe(500000);
  });

  it('passes custom dates', async () => {
    vi.mocked(generatePnL).mockResolvedValue({} as any);
    await GET(req('http://localhost:3008/api/reports/pnl?from=2025-04-01&to=2025-06-30'));
    expect(vi.mocked(generatePnL)).toHaveBeenCalledWith('u1', 'org-1', expect.any(Date), expect.any(Date));
  });

  it('returns 500 on error', async () => {
    vi.mocked(generatePnL).mockRejectedValue(new Error('fail'));
    const res = await GET(req('http://localhost:3008/api/reports/pnl'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/reports/cashflow', () => {
  let GET: any;
  beforeEach(async () => { GET = (await import('@/app/api/reports/cashflow/route')).GET; });

  it('returns projection', async () => {
    vi.mocked(projectCashFlow).mockResolvedValue({ projections:Array(6).fill({month:'2025-05'}), currentBalance:500000 } as any);
    const res = await GET(req('http://localhost:3008/api/reports/cashflow'));
    const d = await res.json();
    expect(res.status).toBe(200); expect(d.projections).toHaveLength(6);
  });

  it('returns 500 on error', async () => {
    vi.mocked(projectCashFlow).mockRejectedValue(new Error('fail'));
    const res = await GET(req('http://localhost:3008/api/reports/cashflow'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/reports/tax', () => {
  let GET: any;
  beforeEach(async () => { GET = (await import('@/app/api/reports/tax/route')).GET; });

  it('returns GST summary', async () => {
    vi.mocked(calculateGSTSummary).mockResolvedValue({ outputTax:{cgst:5000,sgst:5000,igst:0,total:10000}, netPayable:7000 } as any);
    const res = await GET(req('http://localhost:3008/api/reports/tax'));
    const d = await res.json();
    expect(res.status).toBe(200); expect(d.outputTax.total).toBe(10000);
  });

  it('passes custom date range', async () => {
    vi.mocked(calculateGSTSummary).mockResolvedValue({} as any);
    await GET(req('http://localhost:3008/api/reports/tax?from=2025-01-01&to=2025-03-31'));
    expect(vi.mocked(calculateGSTSummary)).toHaveBeenCalledWith('u1', 'org-1', expect.any(Date), expect.any(Date));
  });

  it('returns 500 on error', async () => {
    vi.mocked(calculateGSTSummary).mockRejectedValue(new Error('fail'));
    const res = await GET(req('http://localhost:3008/api/reports/tax'));
    expect(res.status).toBe(500);
  });
});
