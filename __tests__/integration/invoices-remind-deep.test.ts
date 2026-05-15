import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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

// Mock Resend
const mockSend = vi.fn().mockResolvedValue({ id: 'resend-id' });
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend }
  }
}));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/invoices/remind/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);
const now = new Date();

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  process.env.RESEND_API_KEY = 'test_key';
});

describe('/api/invoices/remind', () => {
  describe('GET', () => {
    it('returns pipeline state for overdue invoices', async () => {
      mp.user.findUnique.mockResolvedValue({
        organization: { alertSettings: JSON.stringify({ invoiceReminders: [5, 10] }) }
      } as any);

      mp.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', dueDate: new Date(now.getTime() - 6 * 86400000), total: 1000 } // 6 days overdue
      ] as any);

      mp.auditLog.findMany.mockResolvedValue([
        { resourceId: 'inv-1', details: JSON.stringify({ sequence: 5 }), createdAt: new Date() }
      ] as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.pipeline.length).toBe(1);
      expect(data.pipeline[0].currentStage).toBe(5);
      expect(data.pipeline[0].nextSequence).toBe(10);
      expect(data.stats.totalOverdue).toBe(1000);
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    it('returns 0 sent if reminders disabled', async () => {
      mp.user.findUnique.mockResolvedValue({
        organization: { alertSettings: JSON.stringify({ invoiceReminders: [] }) }
      } as any);

      const res = await POST();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sent).toBe(0);
    });

    it('returns 0 sent if no overdue invoices', async () => {
      mp.user.findUnique.mockResolvedValue(null);
      mp.invoice.findMany.mockResolvedValue([]);

      const res = await POST();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sent).toBe(0);
    });

    it('sends reminder for applicable invoices', async () => {
      mp.user.findUnique.mockResolvedValue(null); // Defaults to [1, 7, 15, 30]
      mp.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', invoiceNumber: 'INV-1', status: 'sent', dueDate: new Date(now.getTime() - 8 * 86400000), total: 1000, client: { email: 'client@test.com' } } // 8 days overdue => sequence 7
      ] as any);
      
      mp.auditLog.findMany.mockResolvedValue([]); // No past reminders

      const res = await POST();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sent).toBe(1);
      
      // Should update to overdue
      expect(prisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'inv-1' },
        data: { status: 'overdue' }
      }));

      // Should send email
      expect(mockSend).toHaveBeenCalled();
    });

    it('skips if reminder already sent', async () => {
      mp.user.findUnique.mockResolvedValue(null);
      mp.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', invoiceNumber: 'INV-1', status: 'overdue', dueDate: new Date(now.getTime() - 8 * 86400000), total: 1000, client: { email: 'client@test.com' } }
      ] as any);
      
      mp.auditLog.findMany.mockResolvedValue([
        { details: JSON.stringify({ sequence: 7 }) }
      ] as any); // Already sent sequence 7

      const res = await POST();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('hits missing false branches in POST', async () => {
      // Not an array
      mp.user.findUnique.mockResolvedValue({ organization: { alertSettings: JSON.stringify({ invoiceReminders: "not_array" }) } } as any);
      mp.invoice.findMany.mockResolvedValue([]);
      await POST();

      // String error
      const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => { throw 'String error'; });
      await POST();
      spy.mockRestore();
    });

    it('returns 500 on unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('Auth failed'));
      const res = await POST();
      expect(res.status).toBe(500);
    });
  });
});
