import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  toLogError: vi.fn((e: any) => ({ message: e?.message || 'Unknown', name: 'Error' })),
}));
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

import { mockPrisma } from '../helpers/prisma-mock';
const mockedPrisma = mockPrisma(prisma);

beforeEach(() => { vi.clearAllMocks(); });

describe('logAudit', () => {
  it('creates an audit log entry with all fields', async () => {
    mockedPrisma.auditLog.create.mockResolvedValue({} as any);
    await logAudit({ userId: 'u1', action: 'create', resource: 'invoice', resourceId: 'inv-1', details: { total: 50000 } });
    expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        action: 'create',
        resource: 'invoice',
        resourceId: 'inv-1',
        details: JSON.stringify({ total: 50000 }),
      }),
    });
  });

  it('handles null details', async () => {
    mockedPrisma.auditLog.create.mockResolvedValue({} as any);
    await logAudit({ userId: 'u1', action: 'delete', resource: 'expense' });
    expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ details: null, resourceId: undefined }),
    });
  });

  it('does not throw on Prisma error (non-blocking)', async () => {
    mockedPrisma.auditLog.create.mockRejectedValue(new Error('DB down'));
    await expect(logAudit({ userId: 'u1', action: 'create', resource: 'test' })).resolves.toBeUndefined();
  });

  it('captures IP from x-forwarded-for header', async () => {
    const { headers } = await import('next/headers');
    vi.mocked(headers).mockResolvedValue({
      get: vi.fn((key: string) => key === 'x-forwarded-for' ? '203.0.113.1, 10.0.0.1' : null),
    } as any);

    mockedPrisma.auditLog.create.mockResolvedValue({} as any);
    await logAudit({ userId: 'u1', action: 'create', resource: 'test' });
    expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ipAddress: '203.0.113.1' }),
    });
  });

  it('uses manual ipAddress override', async () => {
    mockedPrisma.auditLog.create.mockResolvedValue({} as any);
    await logAudit({ userId: 'u1', action: 'create', resource: 'test', ipAddress: '10.0.0.5' });
    expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ipAddress: '10.0.0.5' }),
    });
  });
});
