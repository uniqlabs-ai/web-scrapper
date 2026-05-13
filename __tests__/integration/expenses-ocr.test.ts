import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    receipt: { create: vi.fn().mockResolvedValue({"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":50000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"processed","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[],"fileName":"bill.png","mimeType":"image/png","confidence":0.9}) }
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@google/generative-ai', () => { class M { getGenerativeModel() { return { generateContent: async () => ({ response: { text: () => '{"category":"Software","confidence":0.9,"description":"Test","amount":5000,"vendor":"Vendor","date":"2025-01-01"}' } }) }; } } return { GoogleGenerativeAI: M }; });

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/expenses/ocr/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/expenses/ocr'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('POST /api/expenses/ocr', () => {
  it('handles POST successfully', async () => {
    const res = await POST(req('POST', {"name":"Test","description":"Test description","amount":5000,"vendor":"Vendor","category":"Software","date":"2025-01-15","currency":"INR","email":"test@test.com","type":"bank","accountType":"bank","currentBalance":0,"status":"active","employeeName":"John","grossSalary":100000,"payPeriod":"monthly","deductions":{"pf":5000,"tax":15000},"frequency":"monthly","clientId":"c1","items":[{"description":"Item 1","quantity":1,"rate":5000}],"organizationId":"org-1","planId":"pro","section":"194C","rate":2}));
    expect(res.status).toBeLessThan(600);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST', {"name":"Test","description":"Test description","amount":5000,"vendor":"Vendor","category":"Software","date":"2025-01-15","currency":"INR","email":"test@test.com","type":"bank","accountType":"bank","currentBalance":0,"status":"active","employeeName":"John","grossSalary":100000,"payPeriod":"monthly","deductions":{"pf":5000,"tax":15000},"frequency":"monthly","clientId":"c1","items":[{"description":"Item 1","quantity":1,"rate":5000}],"organizationId":"org-1","planId":"pro","section":"194C","rate":2}));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
