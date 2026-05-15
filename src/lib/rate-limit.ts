/**
 * In-memory sliding-window rate limiter.
 *
 * Uses a Map of timestamps per key with configurable window + max requests.
 * Suitable for single-instance deployments; swap for @upstash/ratelimit in production.
 */
import { NextRequest, NextResponse } from "next/server";

interface RateLimitOptions {
  /** Window in seconds (default: 60) */
  windowSec?: number;
  /** Max requests per window (default: 10) */
  max?: number;
  /** Key prefix for grouping (default: "global") */
  prefix?: string;
}

const store = new Map<string, number[]>();

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(maxAge: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, timestamps] of store.entries()) {
    const filtered = timestamps.filter((t) => now - t < maxAge);
    if (filtered.length === 0) {
      store.delete(key);
    } else {
      store.set(key, filtered);
    }
  }
}

function getClientKey(request: NextRequest): string {
  // Prefer X-Forwarded-For for proxied requests, fall back to IP-like identifier
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  // Fallback: use a hash of available headers
  const ua = request.headers.get("user-agent") || "unknown";
  return `anon-${ua.slice(0, 32)}`;
}

/**
 * Check if the request is rate-limited.
 * Returns a 429 Response if limited, or null if allowed.
 *
 * @example
 * const limited = rateLimit(request, { windowSec: 60, max: 10 });
 * if (limited) return limited;
 */
export function rateLimit(
  request: NextRequest,
  options: RateLimitOptions = {}
): NextResponse | null {
  // Skip rate limiting in test environments
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;

  const { windowSec = 60, max = 10, prefix = "global" } = options;
  const windowMs = windowSec * 1000;

  const clientKey = getClientKey(request);
  const key = `${prefix}:${clientKey}`;
  const now = Date.now();

  // Lazy cleanup
  cleanup(windowMs);

  // Get or create timestamps array
  const timestamps = store.get(key) || [];

  // Filter to only timestamps within the current window
  const recent = timestamps.filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    const retryAfter = Math.ceil((recent[0] + windowMs - now) / 1000);
    return NextResponse.json(
      {
        error: "Too many requests",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil((recent[0] + windowMs) / 1000)),
        },
      }
    );
  }

  // Record this request
  recent.push(now);
  store.set(key, recent);

  return null; // Not limited
}

/** Reset rate limit state — useful for testing */
export function resetRateLimitStore(): void {
  store.clear();
}
