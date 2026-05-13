import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/tds/compute/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks(); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method='POST', url='http://localhost:3008/api/tds/compute', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init as Record<string, unknown>);
}

describe('GET /api/tds/compute', () => {
  it('returns TDS rate table', async () => {
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.rates).toBeDefined();
    expect(d.rates['Professional Services'].section).toBe('194J');
    expect(d.rates['Rent'].rate).toBe(10);
  });
});

describe('POST /api/tds/compute', () => {
  it('computes TDS for Professional Services above threshold', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'Professional Services', amount:100000 }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.applicable).toBe(true);
    expect(d.section).toBe('194J');
    expect(d.rate).toBe(10);
    expect(d.tdsAmount).toBe(10000);
    expect(d.netPayable).toBe(90000);
  });

  it('returns not applicable for amount below threshold', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'Professional Services', amount:20000 }));
    const d = await res.json();
    expect(d.applicable).toBe(false);
    expect(d.tdsAmount).toBe(0);
  });

  it('handles Contractor (company) category', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'Contractor', amount:50000 }));
    const d = await res.json();
    expect(d.applicable).toBe(true);
    expect(d.section).toBe('194C');
    expect(d.rate).toBe(2);
    expect(d.tdsAmount).toBe(1000);
  });

  it('handles keyword fallback for consulting', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'legal advisory consulting', amount:50000 }));
    const d = await res.json();
    expect(d.applicable).toBe(true);
    expect(d.section).toBe('194J');
  });

  it('handles keyword fallback for rent', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'monthly rent payment', amount:500000 }));
    const d = await res.json();
    expect(d.applicable).toBe(true);
    expect(d.section).toBe('194I');
  });

  it('handles keyword fallback for contractor individual', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'contractor work', amount:50000, vendorType:'individual' }));
    const d = await res.json();
    expect(d.applicable).toBe(true);
    expect(d.rate).toBe(1);
  });

  it('handles keyword fallback for commission', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'sales commission', amount:50000 }));
    const d = await res.json();
    expect(d.section).toBe('194H');
  });

  it('handles keyword fallback for interest', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'bank interest income', amount:100000 }));
    const d = await res.json();
    expect(d.section).toBe('194A');
  });

  it('handles keyword fallback for software license', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'annual software license', amount:100000 }));
    const d = await res.json();
    expect(d.section).toBe('194J');
  });

  it('returns not applicable for unknown category', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'Office Snacks', amount:5000 }));
    const d = await res.json();
    expect(d.applicable).toBe(false);
    expect(d.tdsAmount).toBe(0);
  });

  it('returns 400 for missing fields', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'Rent' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(req('POST','http://localhost:3008/api/tds/compute',{ category:'Rent', amount:500000 }));
    expect(res.status).toBe(500);
  });
});
