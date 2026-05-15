import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { count: vi.fn() },
    $queryRawUnsafe: vi.fn()
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class { setCredentials() {} } }, gmail: () => ({ users: { messages: { list: async () => ({ data: { messages: [] } }), get: async () => ({ data: {} }) } } }) } }));

import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/v1/plugin/heartbeat/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/v1/plugin/heartbeat'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/v1/plugin/heartbeat', () => {
  it('handles healthy status', async () => {
    mp.$queryRawUnsafe.mockResolvedValue([{ 1: 1 }] as any);
    mp.user.count.mockResolvedValue(10);
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test';
    process.env.GOOGLE_CLIENT_ID = 'gc_test';
    process.env.GEMINI_API_KEY = 'gem_test';
    process.env.SENTRY_DSN = 'sentry_test';
    
    // Mock process.memoryUsage
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ heapUsed: 100 * 1024 * 1024, heapTotal: 200 * 1024 * 1024 } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.checks.database.status).toBe('ok');
    expect(data.activeUsers).toBe(10);
  });

  it('handles degraded status (missing env var)', async () => {
    mp.$queryRawUnsafe.mockResolvedValue([{ 1: 1 }] as any);
    mp.user.count.mockResolvedValue(10);
    delete process.env.STRIPE_SECRET_KEY;
    
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ heapUsed: 100 * 1024 * 1024, heapTotal: 200 * 1024 * 1024 } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('degraded');
  });

  it('handles unhealthy status (DB error)', async () => {
    mp.$queryRawUnsafe.mockRejectedValue(new Error('Connection failed'));
    mp.user.count.mockRejectedValue(new Error('Failed count'));
    
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ heapUsed: 100 * 1024 * 1024, heapTotal: 200 * 1024 * 1024 } as any);

    const res = await GET();
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('unhealthy');
    expect(data.checks.database.status).toBe('error');
    expect(data.checks.database.detail).toContain('Connection failed');
    expect(data.activeUsers).toBe(0); // count should fallback to 0
  });

  it('handles unhealthy status (Memory error)', async () => {
    mp.$queryRawUnsafe.mockResolvedValue([{ 1: 1 }] as any);
    mp.user.count.mockResolvedValue(10);
    
    // Set heapUsed to > 512MB
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ heapUsed: 600 * 1024 * 1024, heapTotal: 800 * 1024 * 1024 } as any);

    const res = await GET();
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('unhealthy');
    expect(data.checks.memory.status).toBe('error');
    expect(data.checks.memory.detail).toContain('exceeds 512MB threshold');
  });

  it('handles unexpected exceptions during test run', async () => {
    vi.spyOn(process, 'memoryUsage').mockImplementation(() => { throw new Error('Catastrophic failure'); });
    
    const res = await GET();
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('unhealthy');
    expect(data.error).toBe('Catastrophic failure');
  });
});
