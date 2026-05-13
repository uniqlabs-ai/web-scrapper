import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn(), create: vi.fn() },
    user: { update: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(),
  requireUser: vi.fn(),
  getSessionUser: vi.fn(),
  getOrCreateSessionUser: vi.fn(),
  getUserId: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { getSessionUser, getOrCreateSessionUser } from '@/lib/auth';
import { GET, POST } from '@/app/api/onboarding/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mSession = vi.mocked(getSessionUser);
const mGetOrCreate = vi.mocked(getOrCreateSessionUser);

beforeEach(() => {
  vi.clearAllMocks();
});

function req(body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/onboarding'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  } as Record<string, unknown>);
}

describe('GET /api/onboarding', () => {
  it('returns needsAuth=true when no session', async () => {
    mSession.mockResolvedValue(null);
    const res = await GET();
    const data = await res.json();
    expect(data.needsAuth).toBe(true);
    expect(data.onboarded).toBe(false);
  });

  it('returns onboarded=false when user has no org', async () => {
    mSession.mockResolvedValue({ id: 'u1', email: 'a@b.com', fullName: 'Test', organizationId: null } as any);
    const res = await GET();
    const data = await res.json();
    expect(data.needsAuth).toBe(false);
    expect(data.onboarded).toBe(false);
    expect(data.organization).toBeNull();
  });

  it('returns onboarded=true when user has org', async () => {
    mSession.mockResolvedValue({ id: 'u1', email: 'a@b.com', fullName: 'Test', organizationId: 'org-1' } as any);
    mp.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'My Co', currency: 'INR' } as any);
    const res = await GET();
    const data = await res.json();
    expect(data.needsAuth).toBe(false);
    expect(data.onboarded).toBe(true);
    expect(data.organization.name).toBe('My Co');
    expect(data.user.email).toBe('a@b.com');
  });

  it('handles error gracefully', async () => {
    mSession.mockRejectedValue(new Error('session fail'));
    const res = await GET();
    const data = await res.json();
    expect(data.needsAuth).toBe(true);
    expect(data.onboarded).toBe(false);
  });
});

describe('POST /api/onboarding', () => {
  it('creates org and links user successfully', async () => {
    mGetOrCreate.mockResolvedValue({ id: 'u1', email: 'a@b.com' } as any);
    mp.organization.create.mockResolvedValue({ id: 'org-new', name: 'NewCo', currency: 'INR' } as any);
    mp.user.update.mockResolvedValue({} as any);

    const res = await POST(req({ companyName: 'NewCo', companyType: 'Pvt Ltd', gstin: '22AAAAA0000A1Z5', pan: 'ABCDE1234F' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.organization.name).toBe('NewCo');
    expect(mp.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: { organizationId: 'org-new' },
    }));
  });

  it('returns 400 when company name is missing', async () => {
    mGetOrCreate.mockResolvedValue({ id: 'u1' } as any);
    const res = await POST(req({ companyType: 'LLP' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when company name is empty string', async () => {
    mGetOrCreate.mockResolvedValue({ id: 'u1' } as any);
    const res = await POST(req({ companyName: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    mGetOrCreate.mockResolvedValue(null);
    const res = await POST(req({ companyName: 'Test' }));
    expect(res.status).toBe(401);
  });

  it('uses default values for optional fields', async () => {
    mGetOrCreate.mockResolvedValue({ id: 'u1' } as any);
    mp.organization.create.mockResolvedValue({ id: 'org-1', name: 'Co', currency: 'INR' } as any);
    mp.user.update.mockResolvedValue({} as any);

    await POST(req({ companyName: 'Co' }));
    const call = mp.organization.create.mock.calls[0][0] as any;
    expect(call.data.currency).toBe('INR');
    const address = JSON.parse(call.data.address);
    expect(address.companyType).toBe('LLP');
    expect(address.fyStart).toBe('april');
  });

  it('returns 500 on DB error', async () => {
    mGetOrCreate.mockResolvedValue({ id: 'u1' } as any);
    mp.organization.create.mockRejectedValue(new Error('DB fail'));
    const res = await POST(req({ companyName: 'Test' }));
    expect(res.status).toBe(500);
  });
});
