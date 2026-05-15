import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/expenses/[id]/receipt/route';

const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function makeReq(file: File | null): NextRequest {
  const form = new FormData();
  if (file) {
    form.append('receipt', file);
  }
  const req = new NextRequest(new URL('http://localhost:3008/api/expenses/exp1/receipt'), {
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=---' }),
    body: 'fake-body'
  });
  req.formData = async () => form;
  return req;
}

describe('POST /api/expenses/[id]/receipt', () => {
  it('returns 404 if expense not found', async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(null);
    const res = await POST(makeReq(new File(['test'], 'test.jpg', { type: 'image/jpeg' })), { params: Promise.resolve({ id: 'exp1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 if no receipt file provided', async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue({ id: 'exp1' } as any);
    const res = await POST(makeReq(null), { params: Promise.resolve({ id: 'exp1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 if file too large', async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue({ id: 'exp1' } as any);
    const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' });
    Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 });
    const res = await POST(makeReq(largeFile), { params: Promise.resolve({ id: 'exp1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 if invalid file type', async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue({ id: 'exp1' } as any);
    const res = await POST(makeReq(new File(['test'], 'test.txt', { type: 'text/plain' })), { params: Promise.resolve({ id: 'exp1' }) });
    expect(res.status).toBe(400);
  });

  it('uploads receipt successfully', async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue({ id: 'exp1' } as any);
    vi.mocked(prisma.expense.update).mockResolvedValue({ id: 'exp1', receipt: 'data:image/jpeg;base64,...' } as any);
    
    const res = await POST(makeReq(new File(['test'], 'test.jpg', { type: 'image/jpeg' })), { params: Promise.resolve({ id: 'exp1' }) });
    expect(res.status).toBe(200);
    expect(prisma.expense.update).toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq(new File(['test'], 'test.jpg', { type: 'image/jpeg' })), { params: Promise.resolve({ id: 'exp1' }) });
    expect(res.status).toBe(500);
  });
});
