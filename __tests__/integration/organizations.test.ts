import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    organization: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/organizations/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => { vi.clearAllMocks();
  mp.organization?.findMany?.mockResolvedValue?.([]); mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' }); });

function req(method='POST', url='http://localhost:3008/api/organizations', body?:unknown): NextRequest {
  const init:RequestInit = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/organizations', () => {
  it('returns user organizations with active org', async () => {
    (mp.user.findUnique as any).mockResolvedValue({ organizationId:'org-1', organization:{ id:'org-1', name:'MyCompany' } });
    (mp.organization.findMany as any).mockResolvedValue([
      { id:'org-1', name:'MyCompany', currency:'INR' },
      { id:'org-2', name:'SideProject', currency:'USD' },
    ]);
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.organizations).toHaveLength(2);
    expect(d.activeOrgId).toBe('org-1');
  });

  it('returns null activeOrgId when user has no org', async () => {
    (mp.user.findUnique as any).mockResolvedValue({ organizationId:null });
    (mp.organization.findMany as any).mockResolvedValue([]);
    const res = await GET();
    const d = await res.json();
    expect(d.activeOrgId).toBeNull();
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/organizations', () => {
  it('creates a new organization', async () => {
    (mp.organization.create as any).mockResolvedValue({ id:'org-new', name:'NewCorp', currency:'INR' });
    const res = await POST(req('POST','http://localhost:3008/api/organizations',{ name:'NewCorp', currency:'INR' }));
    expect(res.status).toBe(201);
    const d = await res.json();
    expect(d.organization.name).toBe('NewCorp');
  });

  it('returns 400 for invalid payload (missing name)', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/organizations',{ currency:'INR' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid currency length', async () => {
    const res = await POST(req('POST','http://localhost:3008/api/organizations',{ name:'Test', currency:'INVALID' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on Prisma error', async () => {
    (mp.organization.create as any).mockRejectedValue(new Error('DB error'));
    const res = await POST(req('POST','http://localhost:3008/api/organizations',{ name:'Test', currency:'INR' }));
    expect(res.status).toBe(500);
  });
});
