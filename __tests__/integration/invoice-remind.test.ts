import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    invoice: { findMany: vi.fn(), update: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/invoices/remind/route';

const mp = vi.mocked(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
});

describe('GET /api/invoices/remind', () => {
  it('returns pipeline state for overdue invoices', async () => {
    (mp.user.findUnique as any).mockResolvedValue({ organization: { alertSettings: null } });
    const overdue = new Date(Date.now() - 10 * 86400000);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id:'inv-1', invoiceNumber:'INV-001', total:100000, dueDate:overdue, status:'sent', client:{ name:'Acme', email:'a@b.com' } },
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);

    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.pipeline).toBeDefined();
  });

  it('returns empty pipeline when no overdue invoices', async () => {
    (mp.user.findUnique as any).mockResolvedValue({ organization: null });
    (mp.invoice.findMany as any).mockResolvedValue([]);

    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.pipeline).toHaveLength(0);
  });

  it('uses custom reminder sequences from alertSettings', async () => {
    (mp.user.findUnique as any).mockResolvedValue({
      organization: { alertSettings: JSON.stringify({ invoiceReminders: [3, 14, 30] }) },
    });
    (mp.invoice.findMany as any).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('handles malformed alertSettings', async () => {
    (mp.user.findUnique as any).mockResolvedValue({
      organization: { alertSettings: 'invalid json' },
    });
    (mp.invoice.findMany as any).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/invoices/remind', () => {
  it('sends reminders for overdue invoices', async () => {
    (mp.user.findUnique as any).mockResolvedValue({ organization: { alertSettings: null, name: 'MyCompany' } });
    const overdue = new Date(Date.now() - 10 * 86400000);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id:'inv-1', invoiceNumber:'INV-001', total:100000, dueDate:overdue, status:'sent', currency:'INR',
        client:{ name:'Acme', email:'client@acme.com' } },
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);
    (mp.invoice.update as any).mockResolvedValue({});

    const res = await POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.sent).toBeDefined();
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
