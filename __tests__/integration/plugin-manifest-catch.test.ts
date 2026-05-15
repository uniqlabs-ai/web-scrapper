/**
 * Coverage surge for plugin/manifest catch block (lines 43-44).
 * Isolates NextResponse.json mock to force the error path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock NextResponse.json to throw on the first call, simulating an internal error
const mockJsonFn = vi.fn();
vi.mock('next/server', () => ({
  NextResponse: {
    json: (...args: any[]) => mockJsonFn(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  toLogError: vi.fn((e: any) => ({ message: e?.message || 'Unknown', name: 'Error' })),
}));

describe('v1/plugin/manifest — catch block coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles error in manifest construction gracefully (catch path)', async () => {
    // First call to NextResponse.json (the manifest response) → throw
    // Second call (the error response) → return a proper response
    mockJsonFn
      .mockImplementationOnce(() => { throw new Error('Simulated serialization error'); })
      .mockImplementationOnce((body: any, init: any) => new Response(JSON.stringify(body), { status: init?.status || 500 }));

    const { GET } = await import('@/app/api/v1/plugin/manifest/route');
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('Failed to serve plugin manifest');
  });
});
