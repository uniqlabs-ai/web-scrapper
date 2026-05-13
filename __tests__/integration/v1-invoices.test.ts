import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn(), create: vi.fn() },
    client: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/api-auth', () => ({ validateApiKey: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ fireWebhook: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { validateApiKey } from '@/lib/api-auth';
import { GET, POST } from '@/app/api/v1/invoices/route';

const mp = vi.mocked(prisma);
const mockAuth = vi.mocked(validateApiKey);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue('org-1');
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/v1/invoices'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/v1/invoices', () => {
  it('returns 401 when API key is invalid', async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('returns invoices', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([
      { id:'inv-1', invoiceNumber:'INV-001', total:10000, client:{ id:'c1', name:'Acme', email:'a@b.com' } },
    ]);
    const res = await GET(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.invoices).toHaveLength(1);
  });

  it('filters by status', async () => {
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await GET(req('GET', undefined, 'http://localhost:3008/api/v1/invoices?status=overdue'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/invoices', () => {
  it('returns 401 when API key is invalid', async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await POST(req('POST', { dueDate: '2025-05-15', lineItems: [] }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await POST(req('POST', { notes: 'No dueDate or lineItems' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when client not in org', async () => {
    (mp.client.findFirst as any).mockResolvedValue(null);
    const res = await POST(req('POST', {
      dueDate: '2025-05-15', clientId: 'c-unknown',
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
    }));
    expect(res.status).toBe(404);
  });

  it('returns 500 when no admin user exists', async () => {
    (mp.client.findFirst as any).mockResolvedValue({ id: 'c1' });
    (mp.user.findFirst as any).mockResolvedValue(null);
    const res = await POST(req('POST', {
      dueDate: '2025-05-15', clientId: 'c1',
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 1000, gstRate: 18 }],
    }));
    expect(res.status).toBe(500);
  });

  it('creates invoice successfully', async () => {
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1' });
    (mp.invoice.create as any).mockResolvedValue({ id: 'inv-new', invoiceNumber: 'INV-123456' });
    const res = await POST(req('POST', {
      dueDate: '2025-05-15', isInterState: false,
      lineItems: [{ description: 'Consulting', quantity: 2, unitPrice: 5000, gstRate: 18 }],
    }));
    expect(res.status).toBe(201);
  });

  it('creates invoice without clientId', async () => {
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1' });
    (mp.invoice.create as any).mockResolvedValue({ id: 'inv-new' });
    const res = await POST(req('POST', {
      dueDate: '2025-05-15', lineItems: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
    }));
    expect(res.status).toBe(201);
  });

  it('returns 500 on error', async () => {
    (mp.user.findFirst as any).mockResolvedValue({ id: 'admin-1' });
    (mp.invoice.create as any).mockRejectedValue(new Error('DB error'));
    const res = await POST(req('POST', {
      dueDate: '2025-05-15', lineItems: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
    }));
    expect(res.status).toBe(500);
  });
});

