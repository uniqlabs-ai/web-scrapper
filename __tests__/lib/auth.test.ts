import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { getSessionUser, getOrCreateSessionUser, requireUser, getAuthUserId, getUserId } from '@/lib/auth';

const mockedSession = vi.mocked(getServerSession);
import { mockPrisma } from '../helpers/prisma-mock';
const mockedPrisma = mockPrisma(prisma);

beforeEach(() => { vi.clearAllMocks(); });

// ── getSessionUser ──────────────────────────────────────────────────

describe('getSessionUser', () => {
  it('returns user from session email', async () => {
    mockedSession.mockResolvedValue({ user: { email: 'admin@founderos.ai' } } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'admin@founderos.ai', organization: null } as any);
    const user = await getSessionUser();
    expect(user!.id).toBe('u1');
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@founderos.ai' },
      include: { organization: true },
    });
  });

  it('returns null when session has no email', async () => {
    mockedSession.mockResolvedValue({ user: {} } as any);
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const user = await getSessionUser();
    expect(user).toBeNull();
  });

  it('returns null when no session at all', async () => {
    mockedSession.mockResolvedValue(null);
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const user = await getSessionUser();
    expect(user).toBeNull();
  });

  it('returns dev user in development mode (NODE_ENV=development)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockedSession.mockResolvedValue(null);
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'dev', email: 'dev@founderos.local' } as any);

    const user = await getSessionUser();
    expect(user).not.toBeNull();
    expect(user!.email).toBe('dev@founderos.local');
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'dev@founderos.local' },
      include: { organization: true },
    });
    vi.unstubAllEnvs();
  });

  it('returns null in dev mode when dev user does not exist', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockedSession.mockResolvedValue(null);
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const user = await getSessionUser();
    expect(user).toBeNull();
    vi.unstubAllEnvs();
  });
});

// ── getOrCreateSessionUser ──────────────────────────────────────────

describe('getOrCreateSessionUser', () => {
  it('returns existing user from session', async () => {
    mockedSession.mockResolvedValue({ user: { email: 'existing@test.com' } } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'u2', email: 'existing@test.com' } as any);
    const user = await getOrCreateSessionUser();
    expect(user!.id).toBe('u2');
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it('creates new user when not in DB', async () => {
    mockedSession.mockResolvedValue({ user: { email: 'new@test.com', name: 'New', image: 'pic.jpg' } } as any);
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'u-new', email: 'new@test.com' } as any);
    const user = await getOrCreateSessionUser();
    expect(user!.id).toBe('u-new');
    expect(mockedPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'new@test.com', fullName: 'New', avatarUrl: 'pic.jpg' }),
    }));
  });

  it('handles missing name/image gracefully', async () => {
    mockedSession.mockResolvedValue({ user: { email: 'bare@test.com' } } as any);
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'u-bare', email: 'bare@test.com' } as any);
    const user = await getOrCreateSessionUser();
    expect(user!.id).toBe('u-bare');
    expect(mockedPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'bare@test.com', fullName: undefined, avatarUrl: undefined }),
    }));
  });

  it('auto-creates dev user in development mode (existing)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockedSession.mockResolvedValue(null);
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'dev', email: 'dev@founderos.local' } as any);

    const user = await getOrCreateSessionUser();
    expect(user!.id).toBe('dev');
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('auto-creates dev user in development mode (new)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockedSession.mockResolvedValue(null);
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'dev-new', email: 'dev@founderos.local', fullName: 'Local Developer' } as any);

    const user = await getOrCreateSessionUser();
    expect(user!.email).toBe('dev@founderos.local');
    expect(user!.fullName).toBe('Local Developer');
    expect(mockedPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'dev@founderos.local', fullName: 'Local Developer' }),
    }));
    vi.unstubAllEnvs();
  });

  it('returns null in production with no session', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockedSession.mockResolvedValue(null);
    const user = await getOrCreateSessionUser();
    expect(user).toBeNull();
    vi.unstubAllEnvs();
  });
});

// ── requireUser ─────────────────────────────────────────────────────

describe('requireUser', () => {
  it('returns user when authenticated', async () => {
    mockedSession.mockResolvedValue({ user: { email: 'admin@test.com' } } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'admin@test.com' } as any);
    const user = await requireUser();
    expect(user.id).toBe('u1');
  });

  it('throws Unauthorized when no user exists', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockedSession.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow('Unauthorized');
    vi.unstubAllEnvs();
  });
});

// ── getAuthUserId ───────────────────────────────────────────────────

describe('getAuthUserId', () => {
  it('returns user ID', async () => {
    mockedSession.mockResolvedValue({ user: { email: 'admin@test.com' } } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'admin@test.com' } as any);
    const id = await getAuthUserId();
    expect(id).toBe('u1');
  });

  it('throws when no user', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockedSession.mockResolvedValue(null);
    await expect(getAuthUserId()).rejects.toThrow('Unauthorized');
    vi.unstubAllEnvs();
  });
});

// ── getUserId ───────────────────────────────────────────────────────

describe('getUserId', () => {
  it('returns id from user object', () => {
    expect(getUserId({ id: 'test-id' })).toBe('test-id');
  });
});
