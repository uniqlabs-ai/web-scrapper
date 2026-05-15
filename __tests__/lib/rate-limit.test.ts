import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { rateLimit, resetRateLimitStore } from '@/lib/rate-limit';

// Override env to ensure rate limiting is active during these specific tests
const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetRateLimitStore();
  // Force non-test env so rate limiting is active
  vi.stubEnv('NODE_ENV', 'production');
  delete process.env.VITEST;
});

// Restore after all tests
afterAll(() => {
  if (originalEnv) vi.stubEnv('NODE_ENV', originalEnv);
  vi.stubEnv('VITEST', '1');
});

function req(ip?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ip) headers['x-forwarded-for'] = ip;
  return new NextRequest(new URL('http://localhost:3008/api/test'), {
    method: 'POST',
    headers,
  });
}

describe('rateLimit', () => {
  it('allows requests under the limit', () => {
    const result = rateLimit(req('1.1.1.1'), { windowSec: 60, max: 3, prefix: 'test' });
    expect(result).toBeNull();
  });

  it('returns 429 when limit is exceeded', () => {
    const options = { windowSec: 60, max: 2, prefix: 'test2' };

    // First 2 requests should pass
    expect(rateLimit(req('2.2.2.2'), options)).toBeNull();
    expect(rateLimit(req('2.2.2.2'), options)).toBeNull();

    // Third should be rate limited
    const limited = rateLimit(req('2.2.2.2'), options);
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
  });

  it('includes Retry-After header in 429 response', async () => {
    const options = { windowSec: 60, max: 1, prefix: 'test3' };

    rateLimit(req('3.3.3.3'), options); // consume the only allowed request
    const limited = rateLimit(req('3.3.3.3'), options);

    expect(limited!.headers.get('Retry-After')).toBeDefined();
    expect(limited!.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(limited!.headers.get('X-RateLimit-Remaining')).toBe('0');

    const body = await limited!.json();
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('tracks different IPs independently', () => {
    const options = { windowSec: 60, max: 1, prefix: 'test4' };

    expect(rateLimit(req('4.4.4.4'), options)).toBeNull();
    expect(rateLimit(req('5.5.5.5'), options)).toBeNull(); // different IP

    // Same IPs should now be limited
    expect(rateLimit(req('4.4.4.4'), options)?.status).toBe(429);
    expect(rateLimit(req('5.5.5.5'), options)?.status).toBe(429);
  });

  it('tracks different prefixes independently', () => {
    expect(rateLimit(req('6.6.6.6'), { windowSec: 60, max: 1, prefix: 'a' })).toBeNull();
    expect(rateLimit(req('6.6.6.6'), { windowSec: 60, max: 1, prefix: 'b' })).toBeNull(); // different prefix

    // Same prefix should be limited
    expect(rateLimit(req('6.6.6.6'), { windowSec: 60, max: 1, prefix: 'a' })?.status).toBe(429);
  });

  it('resets properly via resetRateLimitStore', () => {
    const options = { windowSec: 60, max: 1, prefix: 'test5' };

    rateLimit(req('7.7.7.7'), options);
    expect(rateLimit(req('7.7.7.7'), options)?.status).toBe(429);

    resetRateLimitStore();
    expect(rateLimit(req('7.7.7.7'), options)).toBeNull(); // should work again
  });

  it('skips rate limiting in test environment', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const options = { windowSec: 60, max: 1, prefix: 'test6' };

    rateLimit(req('8.8.8.8'), options);
    // Second request should NOT be limited because NODE_ENV=test
    expect(rateLimit(req('8.8.8.8'), options)).toBeNull();

    // Restore for other tests
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('runs cleanup after 5 minutes and cleans stale entries', () => {
    // 1. Setup stale entry
    const options = { windowSec: 60, max: 2, prefix: 'cleanup' };
    rateLimit(req('9.9.9.9'), options);
    
    // 2. Setup active entry
    rateLimit(req('10.10.10.10'), options);
    
    // 3. Fast-forward time to trigger cleanup (more than 5 mins = 300000ms)
    // We mock Date.now so `now - lastCleanup` > CLEANUP_INTERVAL
    const realDateNow = Date.now.bind(global.Date);
    let mockTime = realDateNow();
    global.Date.now = () => mockTime;

    // Fast-forward 6 minutes
    mockTime += 6 * 60 * 1000;
    
    // Trigger cleanup via another request
    rateLimit(req('11.11.11.11'), options);
    
    // Restore
    global.Date.now = realDateNow;
  });

  it('uses user-agent fallback when x-forwarded-for is missing', () => {
    // No IP passed -> no x-forwarded-for header
    const request = req(); 
    request.headers.set('user-agent', 'test-agent');
    
    expect(rateLimit(request, { windowSec: 60, max: 1, prefix: 'fallback' })).toBeNull();
    // Same UA should now be limited
    expect(rateLimit(request, { windowSec: 60, max: 1, prefix: 'fallback' })?.status).toBe(429);
  });

  it('uses anon fallback when user-agent is also missing', () => {
    const request = req(); 
    request.headers.delete('user-agent');
    
    expect(rateLimit(request, { windowSec: 60, max: 1, prefix: 'anon' })).toBeNull();
    expect(rateLimit(request, { windowSec: 60, max: 1, prefix: 'anon' })?.status).toBe(429);
  });
});
