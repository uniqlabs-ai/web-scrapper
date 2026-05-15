import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { requireTenant } from '@/lib/tenant';
import { POST, GET } from '@/app/api/tds/compute/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function makeReq(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/tds/compute'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
}

describe('POST /api/tds/compute', () => {
  it('returns 400 when missing category or amount', async () => {
    const res = await POST(makeReq({ category: 'Rent' }));
    expect(res.status).toBe(400);
  });

  it('computes TDS correctly for exact category match', async () => {
    const res = await POST(makeReq({ category: 'Professional Services', amount: 50000 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applicable).toBe(true);
    expect(data.section).toBe('194J');
    expect(data.tdsAmount).toBe(5000);
    expect(data.netPayable).toBe(45000);
  });

  it('computes TDS correctly with keyword fallback (rent)', async () => {
    const res = await POST(makeReq({ category: 'Office Lease', amount: 300000 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applicable).toBe(true);
    expect(data.section).toBe('194I');
    expect(data.tdsAmount).toBe(30000);
  });

  it('computes TDS correctly with keyword fallback (contractor individual)', async () => {
    const res = await POST(makeReq({ category: 'Labour', amount: 50000, vendorType: 'individual' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applicable).toBe(true);
    expect(data.section).toBe('194C');
    expect(data.rate).toBe(1);
    expect(data.tdsAmount).toBe(500);
  });

  it('returns not applicable if below threshold', async () => {
    const res = await POST(makeReq({ category: 'Professional Services', amount: 20000 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applicable).toBe(false);
    expect(data.tdsAmount).toBe(0);
    expect(data.message).toContain('below threshold');
  });

  it('returns not applicable for unknown category', async () => {
    const res = await POST(makeReq({ category: 'Unknown Stuff', amount: 50000 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applicable).toBe(false);
    expect(data.message).toBe('TDS not applicable for this category');
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq({ category: 'Rent', amount: 1000 }));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/tds/compute', () => {
  it('returns rate table', async () => {
    const req = new NextRequest(new URL('http://localhost:3008/api/tds/compute'));
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rates['Professional Services']).toBeDefined();
  });
});
