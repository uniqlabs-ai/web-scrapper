import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';
import { POST } from '@/app/api/gst/cleartax/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const mAudit = vi.mocked(logAudit);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  global.fetch = vi.fn();
});

function makeReq(body: any): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/gst/cleartax'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
}

describe('POST /api/gst/cleartax', () => {
  it('returns 400 if action or period is missing', async () => {
    const res = await POST(makeReq({ action: 'gstr1' }));
    expect(res.status).toBe(400);
  });

  it('handles malformed alertSettings JSON gracefully', async () => {
    mp.user.findUnique.mockResolvedValue({
      organization: { alertSettings: 'invalid json' }
    } as any);

    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('ClearTax API Key not configured');
  });

  it('returns 400 if cleartaxApiKey is not configured', async () => {
    mp.user.findUnique.mockResolvedValue({
      organization: { alertSettings: JSON.stringify({}) }
    } as any);

    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(400);
  });

  it('syncs to cleartax successfully', async () => {
    mp.user.findUnique.mockResolvedValue({
      organization: {
        gstNumber: 'GST123',
        alertSettings: JSON.stringify({ cleartaxApiKey: 'secret-key' })
      }
    } as any);

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({})
    } as any);

    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(200);
    
    expect(global.fetch).toHaveBeenCalledWith('https://api.clear.in/integration/v1/gstr1', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({
        'x-cleartax-auth-token': 'secret-key'
      }),
      body: expect.any(String)
    }));

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mAudit).toHaveBeenCalled();
  });

  it('returns 500 when fetch fails', async () => {
    mp.user.findUnique.mockResolvedValue({
      organization: { alertSettings: JSON.stringify({ cleartaxApiKey: 'key' }) }
    } as any);

    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    } as any);

    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('HTTP Error: 401');
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(500);
  });

  it('returns 400 when user has no organization', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: null } as any);
    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('ClearTax API Key');
  });

  it('returns 400 when alertSettings is null', async () => {
    mp.user.findUnique.mockResolvedValue({ organization: { alertSettings: null } } as any);
    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(400);
  });

  it('uses empty string for gstNumber when organization has no gstNumber', async () => {
    mp.user.findUnique.mockResolvedValue({
      organization: {
        gstNumber: null,
        alertSettings: JSON.stringify({ cleartaxApiKey: 'key' })
      }
    } as any);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as any);

    const res = await POST(makeReq({ action: 'gstr3b', period: '052024' }));
    expect(res.status).toBe(200);
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as any).body);
    expect(body.gstin).toBe('');
  });

  it('returns 500 with non-Error exception message', async () => {
    mt.mockRejectedValue('string error');
    const res = await POST(makeReq({ action: 'gstr1', period: '042024' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Failed to sync to ClearTax');
  });
});
