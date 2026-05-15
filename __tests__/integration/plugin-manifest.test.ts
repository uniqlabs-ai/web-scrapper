import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma before importing the route
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    user: { count: vi.fn() },
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { GET } from '@/app/api/v1/plugin/manifest/route';

describe('GET /api/v1/plugin/manifest', () => {
  const origEnv = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.NEXT_PUBLIC_APP_URL = origEnv;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  it('returns valid manifest JSON', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('finance');
    expect(data.name).toBe('Finance');
    expect(data.icon).toBe('💰');
  });

  it('includes copilot capabilities', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.copilot).toBeDefined();
    expect(data.copilot.queryEndpoint).toBe('/api/v1/copilot/query');
    expect(data.copilot.capabilities).toBeInstanceOf(Array);
    expect(data.copilot.capabilities.length).toBeGreaterThan(0);
  });

  it('includes query definitions', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.copilot.queries).toBeInstanceOf(Array);
    expect(data.copilot.queries.length).toBeGreaterThanOrEqual(5);

    // Each query must have name + description
    for (const query of data.copilot.queries) {
      expect(query.name).toBeDefined();
      expect(query.description).toBeDefined();
      expect(typeof query.name).toBe('string');
      expect(typeof query.description).toBe('string');
    }
  });

  it('includes action definitions with confirmRequired flag', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.copilot.actions).toBeInstanceOf(Array);
    for (const action of data.copilot.actions) {
      expect(action.name).toBeDefined();
      expect(action.description).toBeDefined();
      expect(typeof action.confirmRequired).toBe('boolean');
    }
  });

  it('includes auth configuration', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.auth).toBeDefined();
    expect(data.auth.type).toBe('shared-session');
    expect(data.auth.tokenEndpoint).toBe('/api/v1/auth/founder-os-token');
  });

  it('includes webhook events', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.webhookEvents).toBeInstanceOf(Array);
    expect(data.webhookEvents).toContain('invoice.created');
    expect(data.webhookEvents).toContain('invoice.paid');
  });

  it('uses default URL when NEXT_PUBLIC_APP_URL is not set', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await GET();
    const data = await response.json();
    expect(data.url).toBe('http://localhost:3008');
  });

  it('uses NEXT_PUBLIC_APP_URL when set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://finance.founderos.com';
    const response = await GET();
    const data = await response.json();
    expect(data.url).toBe('https://finance.founderos.com');
  });
});

