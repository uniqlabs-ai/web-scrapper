import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSendEmail = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSendEmail };
  }
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    invoice: { findMany: vi.fn(), update: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/invoices/remind/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  process.env.RESEND_API_KEY = 'test-key';
});

function req(method='GET'): NextRequest {
  const init: Record<string,unknown> = { method };
  return new NextRequest(new URL('http://localhost:3008/api/invoices/remind'), init);
}

describe('GET /api/invoices/remind', () => {
  it('returns pipeline with default sequences and sent reminders', async () => {
    (mp.user.findUnique as any).mockResolvedValue(null);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 10); // 10 days past due
    
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'sent', client: { name: 'Acme' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { resourceId: 'inv1', createdAt: new Date(), details: JSON.stringify({ sequence: 7 }) }
    ]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.pipeline[0].daysPastDue).toBe(10);
    expect(d.pipeline[0].currentStage).toBe(7);
    expect(d.pipeline[0].nextSequence).toBe(1);
  });

  it('handles malformed alertSettings and audit details', async () => {
    (mp.user.findUnique as any).mockResolvedValue({
      organization: { alertSettings: 'invalid-json' }
    });
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 2); // 2 days past due
    
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'sent', client: { name: 'Acme' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { resourceId: 'inv1', createdAt: new Date(), details: 'invalid-json-too' }
    ]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.pipeline[0].currentStage).toBe(1);
  });

  it('handles custom alertSettings sequences', async () => {
    (mp.user.findUnique as any).mockResolvedValue({
      organization: { alertSettings: JSON.stringify({ invoiceReminders: [3, 10, 20] }) }
    });
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 5);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'sent', client: { name: 'Acme' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);

    const res = await GET(req());
    const d = await res.json();
    expect(d.pipeline[0].nextSequence).toBe(3);
  });

  it('handles empty overdue invoices', async () => {
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await GET(req());
    const d = await res.json();
    expect(d.pipeline).toHaveLength(0);
    expect(d.stats.totalOverdue).toBe(0);
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/invoices/remind', () => {
  it('returns early if reminders are disabled', async () => {
    (mp.user.findUnique as any).mockResolvedValue({
      organization: { alertSettings: JSON.stringify({ invoiceReminders: [] }) }
    });
    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(0);
    expect(d.message).toContain('disabled');
  });

  it('returns early if no overdue invoices', async () => {
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([]);
    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(0);
    expect(d.message).toContain('No overdue');
  });

  it('sends email and updates invoice status', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 8); // 8 days past due -> sequence 7
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, issueDate: new Date(), status: 'sent', client: { name: 'Acme', email: 'acme@acme.com' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);
    
    mockSendEmail.mockResolvedValue({});
    (mp.invoice.update as any).mockResolvedValue({});

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(1);
    expect(mp.invoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'overdue' } }));
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it('skips if already sent sequence', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 8); // 8 days past due -> sequence 7
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'overdue', client: { name: 'Acme' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { details: JSON.stringify({ sequence: 7 }) }
    ]);

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(0); // skipped
  });

  it('handles email send error', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 31); // sequence 30 URGENT
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, issueDate: new Date(), status: 'overdue', client: { name: 'Acme', email: 'acme@acme.com' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);
    
    mockSendEmail.mockRejectedValue(new Error('Sendgrid down'));

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(0); // emailSent is false, sent is 0
  });

  it('handles URGENT sequence email content', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 32); // 32 days past due -> sequence 30
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, issueDate: new Date(), status: 'overdue', client: { name: 'Acme', email: 'acme@acme.com' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);
    mockSendEmail.mockResolvedValue({});

    const res = await POST(req('POST'));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('URGENT:')
    }));
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST'));
    expect(res.status).toBe(500);
  });

  it('skips invoice not overdue enough for first sequence', async () => {
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() - 6); // only hours ago, daysPastDue = 0
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'sent', client: { name: 'Acme', email: 'acme@acme.com' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.results).toHaveLength(0);
  });

  it('handles invoice with no client email (skips email)', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 3);
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, issueDate: new Date(), status: 'overdue', client: { name: 'Acme', email: null } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(0);
    expect(d.results[0].emailSent).toBe(false);
  });

  it('handles no RESEND_API_KEY set', async () => {
    delete process.env.RESEND_API_KEY;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 3);
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, issueDate: new Date(), status: 'overdue', client: { name: 'Acme', email: 'acme@acme.com' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(0);
    expect(d.results[0].emailSent).toBe(false);
  });

  it('handles audit details as object (not string)', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 8);
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'overdue', client: { name: 'Acme' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { details: { sequence: 7 } } // object, not string
    ]);

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(0); // already sent
  });

  it('handles audit with null details', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 3);
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, issueDate: new Date(), status: 'overdue', client: { name: 'Acme', email: 'acme@acme.com' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { details: null }
    ]);
    mockSendEmail.mockResolvedValue({});

    const res = await POST(req('POST'));
    const d = await res.json();
    expect(d.sent).toBe(1);
  });

  it('uses Reminder urgency for sequence 15', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 16);
    (mp.user.findUnique as any).mockResolvedValue(null);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, issueDate: new Date(), status: 'overdue', client: { name: 'Acme', email: 'acme@acme.com' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([]);
    mockSendEmail.mockResolvedValue({});

    const res = await POST(req('POST'));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('Reminder:')
    }));
  });
});

describe('GET /api/invoices/remind (additional branches)', () => {
  it('handles audit details as object in GET pipeline', async () => {
    (mp.user.findUnique as any).mockResolvedValue(null);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 10);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'sent', client: { name: 'Acme', email: null } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { resourceId: 'inv1', createdAt: new Date(), details: { sequence: 1 } }
    ]);

    const res = await GET(req());
    const d = await res.json();
    expect(d.pipeline[0].sentReminders).toHaveLength(1);
    expect(d.pipeline[0].clientEmail).toBeNull();
  });

  it('handles fully escalated invoice (all sequences completed)', async () => {
    (mp.user.findUnique as any).mockResolvedValue(null);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 35);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'overdue', client: null }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { resourceId: 'inv1', createdAt: new Date(), details: JSON.stringify({ sequence: 1 }) },
      { resourceId: 'inv1', createdAt: new Date(), details: JSON.stringify({ sequence: 7 }) },
      { resourceId: 'inv1', createdAt: new Date(), details: JSON.stringify({ sequence: 15 }) },
      { resourceId: 'inv1', createdAt: new Date(), details: JSON.stringify({ sequence: 30 }) },
    ]);

    const res = await GET(req());
    const d = await res.json();
    expect(d.pipeline[0].isFullyEscalated).toBe(true);
    expect(d.pipeline[0].clientName).toBe('Unknown');
  });

  it('handles audit details without sequence field', async () => {
    (mp.user.findUnique as any).mockResolvedValue(null);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 5);
    (mp.invoice.findMany as any).mockResolvedValue([
      { id: 'inv1', invoiceNumber: 'INV-1', total: 1000, dueDate, status: 'sent', client: { name: 'Acme' } }
    ]);
    (mp.auditLog.findMany as any).mockResolvedValue([
      { resourceId: 'inv1', createdAt: new Date(), details: JSON.stringify({ action: 'sent' }) }
    ]);

    const res = await GET(req());
    const d = await res.json();
    expect(d.pipeline[0].sentReminders).toHaveLength(0);
  });
});

