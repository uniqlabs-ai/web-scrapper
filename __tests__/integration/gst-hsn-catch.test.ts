/**
 * Coverage surge for gst/hsn catch block (lines 68-69).
 * Isolates NextResponse.json mock to force the error path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock NextResponse.json to throw on first call to enter the catch block
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

describe('gst/hsn — catch block coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles error in HSN response gracefully (catch path)', async () => {
    // First call (the codes response) → throw
    // Second call (the error response) → return a proper response
    mockJsonFn
      .mockImplementationOnce(() => { throw new Error('Simulated serialization error'); })
      .mockImplementationOnce((body: any, init: any) => new Response(JSON.stringify(body), { status: init?.status || 500 }));

    const { GET } = await import('@/app/api/gst/hsn/route');
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Failed');
  });
});
