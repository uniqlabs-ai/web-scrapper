import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { GET } from '@/app/api/gst/hsn/route';

describe('GET /api/gst/hsn', () => {
  it('returns hsn codes', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.codes.length).toBeGreaterThan(0);
    expect(data.groups.services.length).toBeGreaterThan(0);
    expect(data.groups.goods.length).toBeGreaterThan(0);
  });
});
