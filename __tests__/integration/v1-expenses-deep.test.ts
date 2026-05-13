import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/api-auth', () => ({ validateApiKey: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ fireWebhook: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { validateApiKey } from '@/lib/api-auth';
import { fireWebhook } from '@/lib/webhooks';
import { GET, POST } from '@/app/api/v1/expenses/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mAuth = vi.mocked(validateApiKey);
const mWebhook = vi.mocked(fireWebhook);

beforeEach(() => {
  vi.clearAllMocks();
  mAuth.mockResolvedValue('org-1');
  mWebhook.mockResolvedValue(undefined as any);
});

function req(method='GET', url='http://localhost:3008/api/v1/expenses', body?:unknown): NextRequest {
  const init: Record<string, unknown> = { method };
  if (body) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/v1/expenses', () => {
  it('returns expenses for valid API key', async () => {
    mp.expense.findMany.mockResolvedValue([{ id: 'e1', description: 'AWS', amount: 5000 }] as any);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.expenses).toHaveLength(1);
  });

  it('returns 401 when API key is invalid', async () => {
    mAuth.mockResolvedValue(null as any);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('filters by vendor when provided', async () => {
    mp.expense.findMany.mockResolvedValue([] as any);
    await GET(req('GET', 'http://localhost:3008/api/v1/expenses?vendor=AWS'));
    expect(mp.expense.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendor: 'AWS' }),
    }));
  });

  it('includes category in response', async () => {
    mp.expense.findMany.mockResolvedValue([{ id: 'e1', category: { id: 'c1', name: 'Software' } }] as any);
    const res = await GET(req());
    const data = await res.json();
    expect(data.expenses[0].category).toBeDefined();
  });
});

describe('POST /api/v1/expenses', () => {
  it('creates expense successfully', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'admin-1', organizationId: 'org-1', role: 'admin' } as any);
    mp.expense.create.mockResolvedValue({ id: 'exp-new', description: 'SaaS', amount: 5000 } as any);
    const res = await POST(req('POST', 'http://localhost:3008/api/v1/expenses', {
      description: 'SaaS Subscription', amount: 5000, vendor: 'GitHub',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.expense.id).toBe('exp-new');
    expect(mWebhook).toHaveBeenCalledWith('org-1', 'expense.created', expect.anything());
  });

  it('returns 401 when API key is invalid', async () => {
    mAuth.mockResolvedValue(null as any);
    const res = await POST(req('POST', 'http://localhost:3008/api/v1/expenses', { description: 'T', amount: 100 }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when description is missing', async () => {
    const res = await POST(req('POST', 'http://localhost:3008/api/v1/expenses', { amount: 100 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('description and amount');
  });

  it('returns 400 when amount is missing', async () => {
    const res = await POST(req('POST', 'http://localhost:3008/api/v1/expenses', { description: 'Test' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 when no admin user found', async () => {
    mp.user.findFirst.mockResolvedValue(null);
    const res = await POST(req('POST', 'http://localhost:3008/api/v1/expenses', { description: 'T', amount: 100 }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('no active admin');
  });

  it('uses current date when no date provided', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'admin-1' } as any);
    mp.expense.create.mockResolvedValue({ id: 'e1' } as any);
    await POST(req('POST', 'http://localhost:3008/api/v1/expenses', { description: 'T', amount: 100 }));
    const call = mp.expense.create.mock.calls[0][0] as any;
    expect(call.data.date).toBeInstanceOf(Date);
  });

  it('uses provided date when given', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'admin-1' } as any);
    mp.expense.create.mockResolvedValue({ id: 'e1' } as any);
    await POST(req('POST', 'http://localhost:3008/api/v1/expenses', { description: 'T', amount: 100, date: '2025-06-15' }));
    const call = mp.expense.create.mock.calls[0][0] as any;
    expect(call.data.date).toEqual(new Date('2025-06-15'));
  });

  it('returns 500 on DB error', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'admin-1' } as any);
    mp.expense.create.mockRejectedValue(new Error('DB error'));
    const res = await POST(req('POST', 'http://localhost:3008/api/v1/expenses', { description: 'T', amount: 100 }));
    expect(res.status).toBe(500);
  });
});
