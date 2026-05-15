import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mFetch = vi.fn();
globalThis.fetch = mFetch;

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { GET } from '@/app/api/fx/rates/route';
import { STATIC_RATES } from '@/lib/currency';

beforeEach(() => {
  vi.clearAllMocks();
});

function req(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3008/api/fx/rates');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url);
}

describe('GET /api/fx/rates', () => {
  it('fetches live rates successfully', async () => {
    mFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { USD: 0.012, EUR: 0.011, GBP: 0.0095, UNKNOWN: 1.5 } })
    } as any);

    const res = await GET(req({ from: 'USD', to: 'INR', amount: '100' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isLive).toBe(true);
    expect(data.from).toBe('USD');
    expect(data.to).toBe('INR');
    expect(data.amount).toBe(100);
    // 1 / 0.012 = 83.3333
    // converted = 100 * 83.3333 = 8333.33
    expect(data.rate).toBeCloseTo(83.3333, 1);
  });

  it('falls back to static rates if live fetch fails (not ok)', async () => {
    mFetch.mockResolvedValue({ ok: false } as any);

    const res = await GET(req({ from: 'USD', to: 'INR', amount: '10' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isLive).toBe(false);
    expect(data.rate).toBe(STATIC_RATES['USD']); // Assuming INR=1
  });

  it('falls back to static rates if live fetch throws', async () => {
    mFetch.mockRejectedValue(new Error('Network error'));

    const res = await GET(req({ from: 'EUR', to: 'USD', amount: '10' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isLive).toBe(false);
    expect(data.rate).toBeCloseTo(STATIC_RATES['EUR'] / STATIC_RATES['USD'], 4);
  });

  it('handles default params and unmapped currencies', async () => {
    mFetch.mockRejectedValue(new Error('Network error'));

    const res = await GET(req());
    const data = await res.json();
    expect(data.from).toBe('USD');
    expect(data.to).toBe('INR');
    expect(data.amount).toBe(1);
    
    // Testing unmapped currency
    const res2 = await GET(req({ from: 'XYZ', to: 'ABC' }));
    const data2 = await res2.json();
    expect(data2.rate).toBe(1);
  });

  it('returns 500 on unexpected errors', async () => {
    // Mocking URL to throw an error
    const reqWithInvalidUrl = { url: 'invalid-url' } as NextRequest;
    const res = await GET(reqWithInvalidUrl);
    expect(res.status).toBe(500);
  });
});
