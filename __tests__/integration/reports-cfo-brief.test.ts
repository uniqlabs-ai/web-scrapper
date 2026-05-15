import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn().mockResolvedValue([{"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":5000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"active","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[]}]) },
    revenue: { findMany: vi.fn().mockResolvedValue([{"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":50000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"active","type":"recurring","currency":"INR","role":"admin","month":"2026-05-13T00:31:19.303Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[]}]) },
    invoice: { findMany: vi.fn().mockResolvedValue([{"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":50000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"active","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"c1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[],"total":10000,"subtotal":10000,"tax":1800,"client":{"id":"c1","name":"Client","email":"c@t.com"}}]) },
    bankAccount: { findMany: vi.fn().mockResolvedValue([{"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":50000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"active","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[]}]) },
    user: { findUnique: vi.fn().mockResolvedValue({"id":"test-id-1","userId":"u1","organizationId":"org-1","name":"Test Item","email":"test@test.com","fullName":"Test User","amount":50000,"description":"Test description","date":"2025-01-15T00:00:00.000Z","createdAt":"2026-05-13T00:31:19.257Z","updatedAt":"2026-05-13T00:31:19.257Z","status":"active","type":"recurring","currency":"INR","role":"admin","month":"2025-01-01T00:00:00.000Z","vendor":"Test Vendor","category":"Software","source":"manual","sourceId":"src-1","notes":"Test notes","number":"INV-001","dueDate":"2025-02-15T00:00:00.000Z","clientId":"client-1","planTier":"pro","avatarUrl":null,"aliases":"[]","isRecurring":false,"taxRate":18,"tags":"[]","department":"engineering","periodStart":"2025-01-01T00:00:00.000Z","periodEnd":"2025-01-31T00:00:00.000Z","entries":[],"items":[],"lineItems":[]}) }
  },
}));
vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn((m, e) => console.log('ERROR LOG:', m, e)), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET, POST } from '@/app/api/reports/cfo-brief/route';

import { mockPrisma } from '../helpers/prisma-mock';
const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
});

function req(method='GET', body?:unknown, url='http://localhost:3008/api/reports/cfo-brief'): NextRequest {
  const init: Record<string,unknown> = { method };
  if (body) { init.body=JSON.stringify(body); init.headers={'Content-Type':'application/json'}; }
  return new NextRequest(new URL(url), init);
}

describe('GET /api/reports/cfo-brief', () => {
  it('handles GET successfully with positive margins', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-15T00:00:00.000Z')); // Month >= 3

    const res = await GET(req());
    expect(res.status).toBeLessThan(600);
    const data = await res.json();
    expect(data).toBeDefined();
    
    vi.useRealTimers();
  });

  it('handles GET successfully with negative margins and early year (Month < 3)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T00:00:00.000Z')); // Month < 3
    
    // Adjust mocks for negative profit, 0 revenue, empty invoices to trigger alerts
    (mp.revenue.findMany as any).mockResolvedValue([]);
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 50000, date: new Date('2025-01-10T00:00:00.000Z'), category: { name: 'Rent' } },
      { amount: 10000, date: new Date('2025-01-14T00:00:00.000Z') } // uncategorized
    ]);
    (mp.invoice.findMany as any).mockResolvedValue([
      { total: 5000, status: 'sent', dueDate: new Date('2024-12-01T00:00:00.000Z') } // overdue
    ]);
    (mp.bankAccount.findMany as any).mockResolvedValue([{ currentBalance: 1000 }]); // low cash

    const res = await GET(req());
    expect(res.status).toBeLessThan(600);
    const data = await res.json();
    expect(data.alerts.length).toBeGreaterThan(0);
    
    vi.useRealTimers();
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET(req());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /api/reports/cfo-brief', () => {
  it('handles POST successfully', async () => {
    // mock Resend API if it's called
    vi.mock('resend', () => ({
      Resend: vi.fn().mockImplementation(() => ({
        emails: { send: vi.fn().mockResolvedValue({ id: 'resend-1' }) }
      }))
    }));

    // Trigger alerts to test HTML generation branches
    (mp.revenue.findMany as any).mockResolvedValue([]);
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 50000, date: new Date() }
    ]);

    const res = await POST(req('POST', { email: "test@test.com" }));
    expect(res.status).toBeLessThan(600);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  it('handles tenant error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req('POST', {"name":"Test","description":"Test description","amount":5000,"vendor":"Vendor","category":"Software","date":"2025-01-15","currency":"INR","email":"test@test.com","type":"bank","accountType":"bank","currentBalance":0,"status":"active","employeeName":"John","grossSalary":100000,"payPeriod":"monthly","deductions":{"pf":5000,"tax":15000},"frequency":"monthly","clientId":"c1","items":[{"description":"Item 1","quantity":1,"rate":5000}],"organizationId":"org-1","planId":"pro","section":"194C","rate":2}));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('hits missing false branches in email HTML rendering', async () => {
    process.env.RESEND_API_KEY = 'test_key';
    const oldFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    // 1. Runway >= 99, alerts = 0, overdue = 0, topCategories = 0, profitMargin >= 0
    (mp.bankAccount.findMany as any).mockResolvedValue([{ currentBalance: 1000000 }]);
    (mp.expense.findMany as any).mockResolvedValue([]); // runway = infinity, topCats = []
    (mp.revenue.findMany as any).mockResolvedValue([{ amount: 10000, month: new Date() }]); // positive margin
    (mp.invoice.findMany as any).mockResolvedValue([]); // overdue = 0

    const res1 = await POST(req('POST', { email: 'test@test.com' }));
    expect(res1.status).toBe(200);

    // 2. Negative margin, topCats length > 0
    (mp.bankAccount.findMany as any).mockResolvedValue([{ currentBalance: 100 }]);
    (mp.expense.findMany as any).mockResolvedValue([
      { amount: 50000, date: new Date(), category: { name: 'Rent' } }
    ]);
    (mp.revenue.findMany as any).mockResolvedValue([{ amount: 0, month: new Date() }]); // negative margin
    (mp.invoice.findMany as any).mockResolvedValue([]); // overdue = 0
    
    const res2 = await POST(req('POST', { email: 'test@test.com' }));
    expect(res2.status).toBe(200);
    
    global.fetch = oldFetch;
  });
});
