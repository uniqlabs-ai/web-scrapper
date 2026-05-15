/**
 * Coverage surge for integrations/gmail POST catch block (line 59).
 * Uses mocked URL constructor to force the error path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock NextResponse.json normally — but mock URL to throw
const mockJsonFn = vi.fn();
vi.mock('next/server', () => ({
  NextResponse: {
    json: (...args: any[]) => mockJsonFn(...args),
  },
  NextRequest: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    integration: { findFirst: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({
  requireTenant: vi.fn(),
  TenantError: class extends Error { constructor(m: string) { super(m); this.name = 'TenantError'; } },
}));

vi.mock('@/lib/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  toLogError: vi.fn((e: any) => ({ message: e?.message || 'Unknown', name: 'Error' })),
}));

describe('integrations/gmail — POST catch block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it('returns 500 when POST throws (catch path, line 59)', async () => {
    // First call → throw (simulating any error during auth URL construction)
    // Second call → return error response
    mockJsonFn
      .mockImplementationOnce(() => { throw new Error('Simulated error in POST'); })
      .mockImplementationOnce((body: any, init: any) => new Response(JSON.stringify(body), { status: init?.status || 500 }));

    const { POST } = await import('@/app/api/integrations/gmail/route');
    const res = await POST();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('Failed to start auth');
  });
});
