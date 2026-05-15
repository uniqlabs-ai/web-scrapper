import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn(),
  logActivity: vi.fn(),
  Role: {} as any,
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { checkPermission, logActivity } from '@/lib/rbac';
import { GET, POST } from '@/app/api/users/route';
import { PATCH } from '@/app/api/users/[id]/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mcp = vi.mocked(checkPermission);

beforeEach(() => {
  vi.clearAllMocks();
  mcp.mockResolvedValue({ allowed: true, user: { id: 'u1', organizationId: 'org-1' }, error: null, status: 200 } as any);
});

function req(method='GET', url='http://localhost:3008/api/users', body?:unknown): NextRequest {
  const init: Record<string, unknown> = { method };
  if (body) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/users', () => {
  it('returns list of users', async () => {
    mp.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.com', fullName: 'User 1', role: 'admin', avatarUrl: null, createdAt: new Date(), _count: { expenses: 5, invoices: 3, activityLogs: 10 } }
    ] as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.users).toHaveLength(1);
  });

  it('returns 403 when permission denied', async () => {
    mcp.mockResolvedValue({ allowed: false, error: 'Forbidden', status: 403 } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns 500 on error', async () => {
    mcp.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/users', () => {
  it('creates a user successfully', async () => {
    mp.user.findUnique.mockResolvedValue(null);
    mp.user.create.mockResolvedValue({ id: 'u-new', email: 'new@test.com', fullName: 'new', role: 'viewer', createdAt: new Date() } as any);
    const res = await POST(req('POST', 'http://localhost:3008/api/users', { email: 'new@test.com', fullName: 'New User' }));
    expect(res.status).toBe(201);
  });

  it('returns 400 when email is missing', async () => {
    const res = await POST(req('POST', 'http://localhost:3008/api/users', { fullName: 'NoEmail' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Email is required');
  });

  it('returns 400 for invalid role', async () => {
    const res = await POST(req('POST', 'http://localhost:3008/api/users', { email: 'x@b.com', role: 'superadmin' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid payload');
  });

  it('returns 409 when email already exists', async () => {
    mp.user.findUnique.mockResolvedValue({ id: 'existing' } as any);
    const res = await POST(req('POST', 'http://localhost:3008/api/users', { email: 'dup@b.com' }));
    expect(res.status).toBe(409);
  });

  it('uses email prefix as fullName when not provided', async () => {
    mp.user.findUnique.mockResolvedValue(null);
    mp.user.create.mockResolvedValue({ id: 'u2', email: 'auto@b.com', fullName: 'auto', role: 'viewer', createdAt: new Date() } as any);
    await POST(req('POST', 'http://localhost:3008/api/users', { email: 'auto@b.com' }));
    const call = mp.user.create.mock.calls[0][0] as any;
    expect(call.data.fullName).toBe('auto');
    expect(call.data.role).toBe('viewer');
  });

  it('returns 403 when permission denied', async () => {
    mcp.mockResolvedValue({ allowed: false, error: 'Forbidden', status: 403 } as any);
    const res = await POST(req('POST', 'http://localhost:3008/api/users', { email: 'a@b.com' }));
    expect(res.status).toBe(403);
  });

  it('returns 500 on unexpected error', async () => {
    mp.user.findUnique.mockRejectedValue(new Error('DB error'));
    const res = await POST(req('POST', 'http://localhost:3008/api/users', { email: 'x@b.com' }));
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/users/[id]', () => {
  it('updates user role successfully', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
    mp.user.update.mockResolvedValue({ id: 'u1', email: 'a@b.com', fullName: 'Updated', role: 'accountant', createdAt: new Date() } as any);
    const r = req('PATCH', 'http://localhost:3008/api/users/u1', { role: 'accountant' });
    const res = await PATCH(r, { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.role).toBe('accountant');
  });

  it('returns 400 for invalid role', async () => {
    const r = req('PATCH', 'http://localhost:3008/api/users/u1', { role: 'superadmin' });
    const res = await PATCH(r, { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(400);
  });

  it('updates fullName and permissions', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
    mp.user.update.mockResolvedValue({ id: 'u1', email: 'a@b.com', fullName: 'NewName', role: 'admin', createdAt: new Date() } as any);
    const r = req('PATCH', 'http://localhost:3008/api/users/u1', { fullName: 'NewName', permissions: { read: true } });
    const res = await PATCH(r, { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(200);
    const call = mp.user.update.mock.calls[0][0] as any;
    expect(call.data.fullName).toBe('NewName');
    expect(call.data.permissions).toBe('{"read":true}');
  });

  it('handles null permissions', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
    mp.user.update.mockResolvedValue({ id: 'u1', email: 'a@b.com', fullName: 'Test', role: 'admin', createdAt: new Date() } as any);
    const r = req('PATCH', 'http://localhost:3008/api/users/u1', { permissions: null });
    const res = await PATCH(r, { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(200);
    const call = mp.user.update.mock.calls[0][0] as any;
    expect(call.data.permissions).toBeNull();
  });

  it('returns 404 when user not found (P2025)', async () => {
    mp.user.findFirst.mockResolvedValue({ id: 'u-missing', organizationId: 'org-1' } as any);
    const err: any = new Error('Not found');
    err.code = 'P2025';
    mp.user.update.mockRejectedValue(err);
    const r = req('PATCH', 'http://localhost:3008/api/users/u-missing', { fullName: 'x' });
    const res = await PATCH(r, { params: Promise.resolve({ id: 'u-missing' }) });
    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mp.user.update.mockRejectedValue(new Error('DB error'));
    const r = req('PATCH', 'http://localhost:3008/api/users/u1', { fullName: 'x' });
    const res = await PATCH(r, { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(500);
  });

  it('returns 403 when permission denied', async () => {
    mcp.mockResolvedValue({ allowed: false, error: 'Forbidden', status: 403 } as any);
    const r = req('PATCH', 'http://localhost:3008/api/users/u1', { role: 'admin' });
    const res = await PATCH(r, { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(403);
  });
});
