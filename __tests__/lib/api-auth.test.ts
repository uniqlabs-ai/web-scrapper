import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { hashApiKey, generateApiKey, validateApiKey } from '@/lib/api-auth';

import { mockPrisma } from '../helpers/prisma-mock';
const mockedPrisma = mockPrisma(prisma);
beforeEach(() => { vi.clearAllMocks(); });

describe('hashApiKey', () => {
  it('returns a SHA-256 hex digest', () => {
    const hash = hashApiKey('fos_sk_test123');
    expect(hash).toHaveLength(64); // SHA-256 = 64 hex chars
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashApiKey('same-key')).toBe(hashApiKey('same-key'));
  });

  it('produces different hashes for different keys', () => {
    expect(hashApiKey('key-a')).not.toBe(hashApiKey('key-b'));
  });
});

describe('generateApiKey', () => {
  it('returns raw key with default prefix', () => {
    const { raw, hash } = generateApiKey();
    expect(raw).toMatch(/^fos_sk_[a-f0-9]{64}$/);
    expect(hash).toHaveLength(64);
  });

  it('uses custom prefix', () => {
    const { raw } = generateApiKey('custom_prefix');
    expect(raw).toMatch(/^custom_prefix_[a-f0-9]{64}$/);
  });

  it('hash matches raw key', () => {
    const { raw, hash } = generateApiKey();
    expect(hashApiKey(raw)).toBe(hash);
  });

  it('generates unique keys each time', () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    expect(k1.raw).not.toBe(k2.raw);
    expect(k1.hash).not.toBe(k2.hash);
  });
});

describe('validateApiKey', () => {
  function makeRequest(authHeader?: string): NextRequest {
    const headers = new Headers();
    if (authHeader) headers.set('Authorization', authHeader);
    return new NextRequest(new URL('http://localhost:3008/api/test'), { headers });
  }

  it('returns organizationId for valid API key', async () => {
    const rawKey = 'fos_sk_test123456789';
    const keyHash = hashApiKey(rawKey);
    mockedPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'ak-1', keyHash, organizationId: 'org-1',
    } as any);
    mockedPrisma.apiKey.update.mockResolvedValue({} as any);

    const result = await validateApiKey(makeRequest(`Bearer ${rawKey}`));
    expect(result).toBe('org-1');
    expect(mockedPrisma.apiKey.findUnique).toHaveBeenCalledWith({ where: { keyHash } });
  });

  it('returns null for missing Authorization header', async () => {
    const result = await validateApiKey(makeRequest());
    expect(result).toBeNull();
  });

  it('returns null for non-Bearer auth', async () => {
    const result = await validateApiKey(makeRequest('Basic dXNlcjpwYXNz'));
    expect(result).toBeNull();
  });

  it('returns null for invalid API key', async () => {
    mockedPrisma.apiKey.findUnique.mockResolvedValue(null);
    const result = await validateApiKey(makeRequest('Bearer invalid_key'));
    expect(result).toBeNull();
  });

  it('updates lastUsedAt asynchronously', async () => {
    const rawKey = 'fos_sk_valid';
    mockedPrisma.apiKey.findUnique.mockResolvedValue({ id: 'ak-1', keyHash: hashApiKey(rawKey), organizationId: 'org-1' } as any);
    mockedPrisma.apiKey.update.mockResolvedValue({} as any);

    await validateApiKey(makeRequest(`Bearer ${rawKey}`));

    // Fire-and-forget update — wait a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedPrisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'ak-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
