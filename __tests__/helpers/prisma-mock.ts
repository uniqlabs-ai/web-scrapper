/**
 * Shared test helper for Vitest + Prisma mock typing.
 *
 * The core problem: `vi.mocked(prisma)` returns the original PrismaClient
 * type which doesn't have `.mockResolvedValue()` etc. We need to deep-cast
 * so that every nested method is seen as a `Mock` by TypeScript.
 */
import type { PrismaClient } from '@prisma/client';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Deep Mock Utility ─────────────────────────────────────────────
// Recursively replaces every function in T with a Vitest Mock
type DeepMockProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R> & DeepMockProxy<T[K]>
    : T[K] extends object
      ? DeepMockProxy<T[K]>
      : T[K];
};

/**
 * Cast the `vi.mocked(prisma)` result to a deep mock proxy.
 * This enables `.mockResolvedValue()`, `.mockRejectedValue()`, etc.
 * on every nested Prisma method while preserving IDE autocompletion.
 *
 * Usage:
 *   import { prisma } from '@/lib/prisma';
 *   import { mockPrisma } from '../helpers/prisma-mock';
 *   const mp = mockPrisma(prisma);
 *   mp.user.findMany.mockResolvedValue([...]);
 */
export function mockPrisma(prisma: PrismaClient): DeepMockProxy<PrismaClient> {
  return prisma as unknown as DeepMockProxy<PrismaClient>;
}

// ─── NextRequest Helper ────────────────────────────────────────────
// Next.js `NextRequest` uses its own `RequestInit` (from `next/server`),
// not the global DOM `RequestInit`. This helper works around the mismatch.
export function createTestRequest(
  method = 'GET',
  url = 'http://localhost:3008/api/test',
  body?: unknown,
): NextRequest {
  const headers = new Headers();
  if (body) headers.set('Content-Type', 'application/json');

  return new NextRequest(new URL(url), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  } as Record<string, unknown>);
}
