import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bankTransaction: { findMany: vi.fn() }
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/expenses/confidence/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mt = vi.mocked(requireTenant);
const mp = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

describe('/api/expenses/confidence', () => {
  describe('GET', () => {
    it('returns 0 rates for empty transactions', async () => {
      mp.bankTransaction.findMany.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.categorizationRate).toBe(0);
      expect(data.reconciliationRate).toBe(0);
      expect(data.avgConfidence).toBe(0);
    });

    it('calculates metrics correctly', async () => {
      mp.bankTransaction.findMany.mockResolvedValue([
        { id: '1', confidence: 0.95, category: 'Software', isReconciled: true }, // High
        { id: '2', confidence: 0.8, category: 'Travel', isReconciled: false }, // Medium
        { id: '3', confidence: 0.5, category: 'Office', isReconciled: false }, // Low
        { id: '4', confidence: null, category: null, isReconciled: false } // Uncategorized
      ] as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(4);
      expect(data.categorized).toBe(3);
      expect(data.uncategorized).toBe(1);
      expect(data.categorizationRate).toBe(75); // 3/4
      expect(data.avgConfidence).toBe(75); // (0.95+0.8+0.5) / 3 = 0.75 * 100
      expect(data.highConfidence).toBe(1);
      expect(data.mediumConfidence).toBe(1);
      expect(data.lowConfidence).toBe(1);
      expect(data.reconciled).toBe(1);
      expect(data.reconciliationRate).toBe(25); // 1/4
    });

    it('handles unexpected exceptions', async () => {
      mt.mockRejectedValue(new Error('fail'));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });
});
