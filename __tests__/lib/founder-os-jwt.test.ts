import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Import after module is available
import { extractFounderOSToken, requireAuth } from '@/lib/founder-os-jwt';

// ── Helper: create a mock NextRequest with Authorization header ──────

function createRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) {
    headers.set('Authorization', authHeader);
  }
  return new NextRequest(new URL('http://localhost:3008/api/test'), { headers });
}

// ── Helper: create a valid JWT payload (base64url encoded) ───────────

function createJWT(payload: Record<string, unknown>, invalidStructure = false): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'fake_signature_for_testing';

  if (invalidStructure) return `${header}.${body}`; // only 2 parts
  return `${header}.${body}.${signature}`;
}

// ── extractFounderOSToken ────────────────────────────────────────────

describe('extractFounderOSToken', () => {
  it('extracts valid token from Bearer header', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-123',
      email: 'founder@founderos.ai',
      organizationId: 'org-456',
      role: 'admin',
      iat: now - 60,
      exp: now + 3600,
    };
    const token = createJWT(payload);
    const request = createRequest(`Bearer ${token}`);
    const result = extractFounderOSToken(request);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-123');
    expect(result!.email).toBe('founder@founderos.ai');
    expect(result!.organizationId).toBe('org-456');
    expect(result!.role).toBe('admin');
    expect(result!.iat).toBe(now - 60);
    expect(result!.exp).toBe(now + 3600);
  });

  it('maps org_id to organizationId (alias support)', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-123',
      email: 'test@test.com',
      org_id: 'org-789',
      iat: now,
      exp: now + 3600,
    };
    const token = createJWT(payload);
    const request = createRequest(`Bearer ${token}`);
    const result = extractFounderOSToken(request);

    expect(result!.organizationId).toBe('org-789');
  });

  it('returns null when no Authorization header', () => {
    const request = createRequest();
    const result = extractFounderOSToken(request);
    expect(result).toBeNull();
  });

  it('returns null when Authorization is not Bearer scheme', () => {
    const request = createRequest('Basic dXNlcjpwYXNz');
    const result = extractFounderOSToken(request);
    expect(result).toBeNull();
  });

  it('returns null for expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const payload = {
      sub: 'user-123',
      email: 'test@test.com',
      iat: past - 7200,
      exp: past, // expired 1 hour ago
    };
    const token = createJWT(payload);
    const request = createRequest(`Bearer ${token}`);
    const result = extractFounderOSToken(request);

    expect(result).toBeNull();
  });

  it('returns null for malformed JWT (not 3 parts)', () => {
    const payload = { sub: 'user-123', email: 'test@test.com' };
    const token = createJWT(payload, true); // only 2 parts
    const request = createRequest(`Bearer ${token}`);
    const result = extractFounderOSToken(request);

    expect(result).toBeNull();
  });

  it('returns null for invalid base64 in payload', () => {
    const request = createRequest('Bearer header.not_valid_base64!!.signature');
    const result = extractFounderOSToken(request);
    expect(result).toBeNull();
  });

  it('returns null for empty Bearer token', () => {
    const request = createRequest('Bearer ');
    const result = extractFounderOSToken(request);
    expect(result).toBeNull();
  });

  it('handles token without organizationId or org_id', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-123',
      email: 'test@test.com',
      iat: now,
      exp: now + 3600,
    };
    const token = createJWT(payload);
    const request = createRequest(`Bearer ${token}`);
    const result = extractFounderOSToken(request);

    expect(result).not.toBeNull();
    expect(result!.organizationId).toBeUndefined();
  });

  it('handles token without role', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-123',
      email: 'test@test.com',
      iat: now,
      exp: now + 3600,
    };
    const token = createJWT(payload);
    const request = createRequest(`Bearer ${token}`);
    const result = extractFounderOSToken(request);

    expect(result!.role).toBeUndefined();
  });

  it('allows token with no exp claim (no expiry check)', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-123',
      email: 'test@test.com',
      iat: now,
    };
    const token = createJWT(payload);
    const request = createRequest(`Bearer ${token}`);
    const result = extractFounderOSToken(request);

    // Token has no exp, the code checks `if (payload.exp && ...)` — should pass through
    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-123');
  });
});

// ── requireAuth ──────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('returns token when valid (delegates to extractFounderOSToken)', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-123',
      email: 'test@test.com',
      iat: now,
      exp: now + 3600,
    };
    const token = createJWT(payload);
    const request = createRequest(`Bearer ${token}`);
    const result = requireAuth(request);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-123');
  });

  it('returns null when no auth header', () => {
    const request = createRequest();
    const result = requireAuth(request);
    expect(result).toBeNull();
  });
});

// ── Production mode (with FOUNDER_OS_JWT_SECRET) ────────────────────

describe('extractFounderOSToken — production mode', () => {
  const JWT_SECRET = 'test-jwt-secret-for-unit-tests-minimum-32-chars!';

  it('rejects token in production when FOUNDER_OS_JWT_SECRET is not set', { timeout: 30000 }, async () => {
    vi.stubEnv('NODE_ENV', 'production');
    // Secret is already not set by default in test env
    delete process.env.FOUNDER_OS_JWT_SECRET;

    // Need to re-import to pick up new env
    vi.resetModules();
    const { extractFounderOSToken: extract } = await import('@/lib/founder-os-jwt');

    const token = createJWT({ sub: 'u1', email: 't@t.com', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 });
    const request = createRequest(`Bearer ${token}`);
    const result = extract(request);

    expect(result).toBeNull();
    vi.unstubAllEnvs();
  });

  it('verifies token cryptographically when secret is set', { timeout: 30000 }, async () => {
    vi.stubEnv('FOUNDER_OS_JWT_SECRET', JWT_SECRET);

    vi.resetModules();
    const jwt = await import('jsonwebtoken');
    const { extractFounderOSToken: extract } = await import('@/lib/founder-os-jwt');

    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: 'user-prod', email: 'prod@test.com', organizationId: 'org-prod', role: 'admin', iat: now, exp: now + 3600 };
    const signedToken = jwt.default.sign(payload, JWT_SECRET);

    const request = createRequest(`Bearer ${signedToken}`);
    const result = extract(request);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-prod');
    expect(result!.email).toBe('prod@test.com');
    expect(result!.organizationId).toBe('org-prod');
    vi.unstubAllEnvs();
  });

  it('rejects token with wrong signature when secret is set', { timeout: 30000 }, async () => {
    vi.stubEnv('FOUNDER_OS_JWT_SECRET', JWT_SECRET);

    vi.resetModules();
    const jwt = await import('jsonwebtoken');
    const { extractFounderOSToken: extract } = await import('@/lib/founder-os-jwt');

    // Sign with a DIFFERENT secret
    const signedToken = jwt.default.sign({ sub: 'u1', email: 't@t.com' }, 'wrong-secret-key-completely-different');

    const request = createRequest(`Bearer ${signedToken}`);
    const result = extract(request);

    expect(result).toBeNull(); // Signature mismatch
    vi.unstubAllEnvs();
  });

  it('rejects expired token even with valid signature', { timeout: 30000 }, async () => {
    vi.stubEnv('FOUNDER_OS_JWT_SECRET', JWT_SECRET);

    vi.resetModules();
    const jwt = await import('jsonwebtoken');
    const { extractFounderOSToken: extract } = await import('@/lib/founder-os-jwt');

    const past = Math.floor(Date.now() / 1000) - 7200;
    const signedToken = jwt.default.sign({ sub: 'u1', email: 't@t.com', iat: past - 3600, exp: past }, JWT_SECRET);

    const request = createRequest(`Bearer ${signedToken}`);
    const result = extract(request);

    expect(result).toBeNull(); // Expired
    vi.unstubAllEnvs();
  });

  it('verifies token and maps org_id correctly in production', { timeout: 30000 }, async () => {
    vi.stubEnv('FOUNDER_OS_JWT_SECRET', JWT_SECRET);

    vi.resetModules();
    const jwt = await import('jsonwebtoken');
    const { extractFounderOSToken: extract } = await import('@/lib/founder-os-jwt');

    const now = Math.floor(Date.now() / 1000);
    // Use org_id instead of organizationId
    const payload = { sub: 'user-prod', email: 'prod@test.com', org_id: 'org-alias', role: 'admin', iat: now, exp: now + 3600 };
    const signedToken = jwt.default.sign(payload, JWT_SECRET);

    const request = createRequest(`Bearer ${signedToken}`);
    const result = extract(request);

    expect(result).not.toBeNull();
    expect(result!.organizationId).toBe('org-alias');
    vi.unstubAllEnvs();
  });

  it('handles non-Error objects thrown during verification', { timeout: 30000 }, async () => {
    vi.stubEnv('FOUNDER_OS_JWT_SECRET', JWT_SECRET);

    vi.resetModules();
    const jwt = await import('jsonwebtoken');
    
    // Mock jwt.verify to throw a string instead of an Error
    vi.spyOn(jwt.default, 'verify').mockImplementationOnce(() => {
      throw 'A string error';
    });

    const { extractFounderOSToken: extract } = await import('@/lib/founder-os-jwt');

    const request = createRequest('Bearer fake-token');
    const result = extract(request);

    expect(result).toBeNull();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
