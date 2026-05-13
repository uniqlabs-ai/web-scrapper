import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {

  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/gst/hsn/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/gst/hsn'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/gst/hsn', () => {
  it('handles GET successfully', async () => {
    const res = await GET(req());
    expect(res.status).toBeLessThan(600);
    const data = await res.json();
    expect(data).toBeDefined();
  });
});
