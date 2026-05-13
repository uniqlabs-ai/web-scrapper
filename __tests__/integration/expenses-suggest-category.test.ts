import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {

  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@google/generative-ai', () => { class M { getGenerativeModel() { return { generateContent: async () => ({ response: { text: () => '{"category":"Software","confidence":0.9,"description":"Test","amount":5000,"vendor":"Vendor","date":"2025-01-01"}' } }) }; } } return { GoogleGenerativeAI: M }; });

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/expenses/suggest-category/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/expenses/suggest-category'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('POST /api/expenses/suggest-category', () => {
  it('handles POST successfully', async () => {
    const res = await POST(req('POST', {"name":"Test","description":"Test description","amount":5000,"vendor":"Vendor","category":"Software","date":"2025-01-15","currency":"INR","email":"test@test.com","type":"bank","accountType":"bank","currentBalance":0,"status":"active","employeeName":"John","grossSalary":100000,"payPeriod":"monthly","deductions":{"pf":5000,"tax":15000},"frequency":"monthly","clientId":"c1","items":[{"description":"Item 1","quantity":1,"rate":5000}],"organizationId":"org-1","planId":"pro","section":"194C","rate":2}));
    expect(res.status).toBeLessThan(600);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST', {"name":"Test","description":"Test description","amount":5000,"vendor":"Vendor","category":"Software","date":"2025-01-15","currency":"INR","email":"test@test.com","type":"bank","accountType":"bank","currentBalance":0,"status":"active","employeeName":"John","grossSalary":100000,"payPeriod":"monthly","deductions":{"pf":5000,"tax":15000},"frequency":"monthly","clientId":"c1","items":[{"description":"Item 1","quantity":1,"rate":5000}],"organizationId":"org-1","planId":"pro","section":"194C","rate":2}));
    expect(res.status).toBeLessThan(600);
  });
});
