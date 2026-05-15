import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    integration: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/integrations/gmail/callback/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  global.fetch = vi.fn();
});

describe('GET /api/integrations/gmail/callback', () => {
  it('redirects on error param', async () => {
    const req = new NextRequest(new URL('http://localhost:3008/api/integrations/gmail/callback?error=access_denied'));
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=gmail_denied');
  });

  it('redirects on missing code', async () => {
    const req = new NextRequest(new URL('http://localhost:3008/api/integrations/gmail/callback'));
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=no_code');
  });

  it('redirects on token exchange failure', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      json: async () => ({ error: 'invalid_grant' })
    } as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/integrations/gmail/callback?code=123'));
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=token_failed');
  });

  it('creates new integration record and redirects to success', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      json: async () => ({ access_token: 'at_1', refresh_token: 'rt_1', scope: 'read' })
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce({
      json: async () => ({ emailAddress: 'test@example.com' })
    } as any);

    mp.integration.findFirst.mockResolvedValue(null);

    const req = new NextRequest(new URL('http://localhost:3008/api/integrations/gmail/callback?code=123'));
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('success=gmail_connected');

    expect(mp.integration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'gmail',
        accessToken: 'at_1',
        refreshToken: 'rt_1'
      })
    }));
  });

  it('updates existing integration record and redirects to success', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      json: async () => ({ access_token: 'at_2', refresh_token: 'rt_2', scope: 'read' })
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce({
      json: async () => ({ emailAddress: 'test2@example.com' })
    } as any);

    mp.integration.findFirst.mockResolvedValue({ id: 'int_1', refreshToken: 'old_rt' } as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/integrations/gmail/callback?code=123'));
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('success=gmail_connected');

    expect(mp.integration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'int_1' },
      data: expect.objectContaining({
        accessToken: 'at_2',
        refreshToken: 'rt_2'
      })
    }));
  });

  it('redirects to error on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const req = new NextRequest(new URL('http://localhost:3008/api/integrations/gmail/callback?code=123'));
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=callback_failed');
  });

  it('falls back to existing refreshToken when OAuth response omits it', async () => {
    // OAuth re-auth flows often omit refresh_token on subsequent authorizations
    vi.mocked(global.fetch).mockResolvedValueOnce({
      json: async () => ({ access_token: 'at_3', scope: 'read' }) // no refresh_token
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce({
      json: async () => ({ emailAddress: 'test3@example.com' })
    } as any);

    mp.integration.findFirst.mockResolvedValue({ id: 'int_2', refreshToken: 'old_rt_kept' } as any);

    const req = new NextRequest(new URL('http://localhost:3008/api/integrations/gmail/callback?code=456'));
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('success=gmail_connected');

    expect(mp.integration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'int_2' },
      data: expect.objectContaining({
        refreshToken: 'old_rt_kept' // should fall back to existing
      })
    }));
  });
});

