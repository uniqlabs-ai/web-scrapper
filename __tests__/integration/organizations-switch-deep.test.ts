import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    user: { update: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/organizations/switch/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('POST /api/organizations/switch', () => {
  function makeReq(body: any): NextRequest {
    return new NextRequest(new URL('http://localhost:3008/api/organizations/switch'), {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body)
    });
  }

  it('returns 400 if organizationId is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 if organization not found or access denied', async () => {
    mp.organization.findFirst.mockResolvedValue(null);
    const res = await POST(makeReq({ organizationId: 'org-2' }));
    expect(res.status).toBe(404);
  });

  it('switches organization successfully', async () => {
    mp.organization.findFirst.mockResolvedValue({ id: 'org-2' } as any);
    mp.user.update.mockResolvedValue({ id: 'u1', organizationId: 'org-2' } as any);

    const res = await POST(makeReq({ organizationId: 'org-2' }));
    expect(res.status).toBe(200);
    expect(mp.user.update).toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(makeReq({ organizationId: 'org-2' }));
    expect(res.status).toBe(500);
  });
});
