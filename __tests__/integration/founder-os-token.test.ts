import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/founder-os-jwt', () => ({ extractFounderOSToken: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { extractFounderOSToken } from '@/lib/founder-os-jwt';
import { POST } from '@/app/api/v1/auth/founder-os-token/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mj = vi.mocked(extractFounderOSToken);

beforeEach(() => { vi.clearAllMocks(); });

function req(): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/v1/auth/founder-os-token'), {
    method: 'POST',
    headers: { 'Authorization': 'Bearer test-token', 'Content-Type': 'application/json' },
  });
}

describe('POST /api/v1/auth/founder-os-token', () => {
  it('returns 401 for invalid/missing JWT', async () => {
    mj.mockReturnValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    const d = await res.json();
    expect(d.error).toContain('Invalid');
  });

  it('exchanges token and returns existing user', async () => {
    const now = Math.floor(Date.now() / 1000);
    mj.mockReturnValue({ sub:'fos-u1', email:'admin@founderos.ai', organizationId:'org-1', role:'admin', iat:now, exp:now+3600 });
    mp.user.findFirst.mockResolvedValue({ id:'u1', email:'admin@founderos.ai', fullName:'Admin' } as any);

    const res = await POST(req());
    const d = await res.json();

    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
    expect(d.user.email).toBe('admin@founderos.ai');
    expect(d.founderOS.sub).toBe('fos-u1');
    expect(d.founderOS.organizationId).toBe('org-1');
    expect(mp.user.create).not.toHaveBeenCalled();
  });

  it('auto-creates user when not found locally', async () => {
    const now = Math.floor(Date.now() / 1000);
    mj.mockReturnValue({ sub:'fos-u2', email:'new@company.com', organizationId:'org-2', role:undefined, iat:now, exp:now+3600 });
    mp.user.findFirst.mockResolvedValue(null);
    mp.user.create.mockResolvedValue({ id:'u-new', email:'new@company.com', fullName:'new' } as any);

    const res = await POST(req());
    const d = await res.json();

    expect(res.status).toBe(200);
    expect(d.success).toBe(true);
    expect(mp.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'new@company.com' }),
    }));
  });

  it('returns expiresAt from token exp claim', async () => {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 7200;
    mj.mockReturnValue({ sub:'fos-u1', email:'t@t.com', iat:now, exp, organizationId:undefined, role:undefined });
    mp.user.findFirst.mockResolvedValue({ id:'u1', email:'t@t.com', fullName:'T' } as any);

    const res = await POST(req());
    const d = await res.json();

    expect(d.expiresAt).toBe(new Date(exp * 1000).toISOString());
  });

  it('returns 500 on database error', async () => {
    const now = Math.floor(Date.now() / 1000);
    mj.mockReturnValue({ sub:'fos-u1', email:'t@t.com', iat:now, exp:now+3600, organizationId:undefined, role:undefined });
    mp.user.findFirst.mockRejectedValue(new Error('DB down'));

    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
