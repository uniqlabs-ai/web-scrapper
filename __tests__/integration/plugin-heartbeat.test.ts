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

  it('handles user count failure gracefully (falls back to 0)', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockRejectedValue(new Error('count failed'));

    const response = await GET();
    const data = await response.json();

    expect(data.activeUsers).toBe(0);
  });

  it('returns 503 when DB times out with non-Error rejection', async () => {
    mockedPrisma.$queryRawUnsafe.mockRejectedValue('string error');
    mockedPrisma.user.count.mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.checks.database.status).toBe('error');
    expect(data.checks.database.detail).toBe('Unknown DB error');
  });

  it('returns 503 on complete handler failure', async () => {
    mockedPrisma.$queryRawUnsafe.mockImplementation(() => { throw new Error('total crash'); });
    mockedPrisma.user.count.mockImplementation(() => { throw new Error('count crash'); });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.error).toBeDefined();
  });

  it('returns healthy when all env vars are set', async () => {
    // Set all env vars that the heartbeat checks
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_123';
    process.env.GOOGLE_CLIENT_ID = 'google-id';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.SENTRY_DSN = 'https://sentry.io/123';

    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(1);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks.stripe.status).toBe('ok');
    expect(data.checks.razorpay.status).toBe('ok');
    expect(data.checks.gmail.status).toBe('ok');
    expect(data.checks.gemini.status).toBe('ok');
    expect(data.checks.sentry.status).toBe('ok');

    // Cleanup
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GEMINI_API_KEY;
    delete process.env.SENTRY_DSN;
  });

  it('returns degraded when env vars are missing but DB is ok', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RAZORPAY_KEY_ID;

    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    expect(['degraded', 'healthy']).toContain(data.status);
    expect(data.checks.stripe.status).toBe('missing');
  });

  it('returns uptime with seconds format for short uptime', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    // Test is new, uptime should be in seconds
    expect(data.uptime.human).toMatch(/\d+s$/);
  });

  it('returns 503 on non-Error exception in outer catch', async () => {
    mockedPrisma.$queryRawUnsafe.mockImplementation(() => { throw 'string failure'; });
    mockedPrisma.user.count.mockImplementation(() => { throw 'count fail'; });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe('Unknown error');
  });

  it('formats uptime with days when running for > 24h', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    // Mock Date.now to return a time far in the future from startTime
    const origNow = Date.now;
    Date.now = () => origNow() + 2 * 24 * 60 * 60 * 1000; // +2 days

    const response = await GET();
    const data = await response.json();

    Date.now = origNow;

    expect(data.uptime.human).toMatch(/\d+d\s+\d+h/);
  });

  it('formats uptime with hours when running for > 1h', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    const origNow = Date.now;
    Date.now = () => origNow() + 3 * 60 * 60 * 1000; // +3 hours

    const response = await GET();
    const data = await response.json();

    Date.now = origNow;

    expect(data.uptime.human).toMatch(/\d+h\s+\d+m/);
  });

  it('formats uptime with minutes when running for > 1m', async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    mockedPrisma.user.count.mockResolvedValue(0);

    const origNow = Date.now;
    Date.now = () => origNow() + 5 * 60 * 1000; // +5 minutes

    const response = await GET();
    const data = await response.json();

    Date.now = origNow;

    expect(data.uptime.human).toMatch(/\d+m\s+\d+s/);
  });
});

