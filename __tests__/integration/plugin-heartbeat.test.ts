import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — factory must not reference outer variables
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    user: { count: vi.fn() },
  },
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  toLogError: vi.fn((e) => ({ message: e?.message || 'Unknown' })),
}));

// Import AFTER mocking
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/v1/plugin/heartbeat/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mockedPrisma = mockPrisma(prisma);

describe('GET /api/v1/plugin/heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy/degraded status when DB is connected', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(5);

    const response = await GET();
    const data = await response.json();

    // Status can be degraded if env vars are missing in test environment
    expect([200, 503]).toContain(response.status);
    expect(['healthy', 'degraded']).toContain(data.status);
    expect(data.product).toBe('finance');
    expect(data.checks.database.status).toBe('ok');
    expect(data.activeUsers).toBe(5);
  });

  it('includes version, uptime, and timestamp', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    expect(data.version).toBe('0.1.0');
    expect(data.uptime).toBeDefined();
    expect(data.uptime.ms).toBeGreaterThanOrEqual(0);
    expect(typeof data.uptime.human).toBe('string');
    expect(data.timestamp).toBeDefined();
  });

  it('includes all subsystem checks', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    const checkKeys = ['database', 'stripe', 'razorpay', 'gmail', 'gemini', 'sentry', 'memory'];
    for (const key of checkKeys) {
      expect(data.checks[key]).toBeDefined();
      expect(['ok', 'error', 'missing']).toContain(data.checks[key].status);
    }
  });

  it('returns unhealthy status when DB fails', async () => {
    mockedPrisma.$queryRawUnsafe.mockRejectedValue(new Error('Connection refused'));
    mockedPrisma.user.count.mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.database.status).toBe('error');
    expect(data.checks.database.detail).toContain('Connection refused');
  });

  it('reports memory usage', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    expect(data.checks.memory.heapUsedMB).toBeGreaterThan(0);
    expect(data.checks.memory.heapTotalMB).toBeGreaterThan(0);
  });
});
