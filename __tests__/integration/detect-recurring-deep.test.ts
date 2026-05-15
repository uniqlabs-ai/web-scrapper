import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn() },
    recurringExpense: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    vendor: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({
  requireTenant: vi.fn(),
  TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} }
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { GET } from '@/app/api/detect-recurring/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mp.recurringExpense.findMany.mockResolvedValue([]);
  mp.employee.findMany.mockResolvedValue([]);
  mp.vendor.findMany.mockResolvedValue([]);
});

describe('GET /api/detect-recurring', () => {
  it('detects basic subscriptions based on frequency and SAAS name', async () => {
    mp.expense.findMany.mockResolvedValue([
      { description: 'Vercel Inc.', amount: 2000, date: new Date('2025-01-01') },
      { description: 'Vercel Inc.', amount: 2000, date: new Date('2025-02-01') },
      { description: 'Vercel Inc.', amount: 2000, date: new Date('2025-03-01') },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.subscriptions.length).toBe(1);
    expect(data.subscriptions[0].kind).toBe('subscription');
    expect(data.subscriptions[0].frequency).toBe('monthly');
  });

  it('detects various prefix strips in descriptions', async () => {
    // Tests extractRecipientName branches
    const descriptions = [
      'MSI/AMAZON WEB SERVICES', // MSI prefix
      'MIN/GOOGLE CLOUD', // MIN prefix
      'BIL/ONL/001174143 662/DigitalOcean', // BIL/ONL
      'MMT/IMPS/12345678/Stripe Payments', // MMT/IMPS
      'INF/NEFT/123/Heroku', // INF/NEFT
      'UPI/123/Slack Corp', // UPI/
      'FT-MPS-1234/Github', // FT-MPS
      'TRF/Notion', // Short TRF
      'Payment P1234567890 Figma', // P+digits
      'Payment 123456789 Canva', // digits
      'HDFC0001234 Render', // IFSC
      '20250101 Datadog', // Date pattern
    ];

    const mockExpenses = descriptions.flatMap((desc, i) => [
      { description: desc, amount: 1500, date: new Date('2025-01-01') },
      { description: desc, amount: 1500, date: new Date('2025-02-01') },
    ]);
    mp.expense.findMany.mockResolvedValue(mockExpenses as any);

    const res = await GET();
    const data = await res.json();
    expect(data.subscriptions.length).toBeGreaterThan(0);
  });

  it('classifies payroll for person names with large amounts', async () => {
    mp.expense.findMany.mockResolvedValue([
      { description: 'John Doe', amount: 50000, date: new Date('2025-01-01') },
      { description: 'John Doe', amount: 50000, date: new Date('2025-02-01') },
    ] as any);

    const res = await GET();
    const data = await res.json();
    expect(data.payroll.length).toBe(1);
    expect(data.payroll[0].kind).toBe('payroll_fixed');
  });

  it('classifies payroll variable for person names with variance > 20%', async () => {
    mp.expense.findMany.mockResolvedValue([
      { description: 'Jane Smith', amount: 40000, date: new Date('2025-01-01') },
      { description: 'Jane Smith', amount: 60000, date: new Date('2025-02-01') },
    ] as any);

    const res = await GET();
    const data = await res.json();
    expect(data.payroll.length).toBe(1);
    expect(data.payroll[0].kind).toBe('payroll_variable');
  });

  it('detects half-yearly frequency', async () => {
    mp.expense.findMany.mockResolvedValue([
      { description: 'Insurance Premium', amount: 5000, date: new Date('2025-01-01'), vendor: null },
      { description: 'Insurance Premium', amount: 5000, date: new Date('2024-07-05'), vendor: null },
    ] as any);

    const res = await GET();
    const data = await res.json();
    
    expect(data.subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Insurance Premium', frequency: 'half-yearly' })
      ])
    );
  });

  it('hits missing false branches in detect-recurring', async () => {
    mp.expense.findMany.mockResolvedValue([
      { description: '', amount: 100, date: new Date('2025-01-01'), vendor: null }, // empty desc
      { description: 'A', amount: 100, date: new Date('2025-01-01'), vendor: null }, // length < 2 -> group ignored
      { description: 'Test -foo', amount: 100, date: new Date('2025-01-01'), vendor: null }, // -foo token starts with special char
      { description: 'Test -foo', amount: 100, date: new Date('2025-02-01'), vendor: null },
      { description: 'A B C D E', amount: 100, date: new Date('2025-01-01'), vendor: null }, // 5 words -> person length > 4 false branch
      { description: 'A B C D E', amount: 100, date: new Date('2025-02-01'), vendor: null },
      { description: 'TieScore', amount: 100, date: new Date('2025-01-01'), vendor: null },
      { description: 'Vendor123', amount: 0, date: new Date('2025-01-01'), vendor: null }, // 0 amount
      { description: 'Vendor123', amount: 0, date: new Date('2025-02-01'), vendor: null },
      { description: 'Vendor123', amount: 0, date: new Date('2025-03-01'), vendor: null },
      { description: 'Vendor123', amount: 0, date: new Date('2025-04-01'), vendor: null }, // 4 identical desc > 3 (hits false branch)
      { description: 'Vendor123', amount: -50, date: new Date('2025-05-01'), vendor: null }, // avg < 0
      { description: 'JustOneMonth', amount: 100, date: new Date('2025-01-01'), vendor: null },
      { description: 'JustOneMonth', amount: 100, date: new Date('2025-01-02'), vendor: null }, // 2 occurrences, 1 distinct month -> hits guessFrequency months.length < 2
    ] as any);

    mp.recurringExpense.findMany.mockResolvedValue([
      { description: 'Recurring1', vendor: null }, // null vendor
      { description: null, vendor: 'Recurring2' }, // null description
    ] as any);
    
    mp.vendor.findMany.mockResolvedValue([
      { name: 'JustOneMonth' } // Vendor exclude set hit
    ] as any);
    
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('excludes FD, TAX, TRF items and single chars', async () => {
    mp.expense.findMany.mockResolvedValue([
      { description: 'TRF TO BANK', amount: 1000, date: new Date('2025-01-01') },
      { description: 'TRF TO BANK', amount: 1000, date: new Date('2025-02-01') },
      { description: 'A', amount: 1000, date: new Date('2025-01-01') },
      { description: 'A', amount: 1000, date: new Date('2025-02-01') },
    ] as any);
    const res = await GET();
    const data = await res.json();
    expect(data.subscriptions.length).toBe(0);
    expect(data.payroll.length).toBe(0);
  });

  it('detects quarterly/half-yearly/yearly frequency', async () => {
    mp.expense.findMany.mockResolvedValue([
      { description: 'Vercel', amount: 2000, date: new Date('2025-01-01') },
      { description: 'Vercel', amount: 2000, date: new Date('2025-04-01') }, // Quarterly gap
      { description: 'AWS', amount: 5000, date: new Date('2025-01-01') },
      { description: 'AWS', amount: 5000, date: new Date('2025-07-01') }, // Half-yearly gap
      { description: 'Github', amount: 10000, date: new Date('2025-01-01') },
      { description: 'Github', amount: 10000, date: new Date('2026-01-01') }, // Yearly gap
    ] as any);

    const res = await GET();
    const data = await res.json();
    
    const vercel = data.subscriptions.find((s:any) => s.name.toLowerCase().includes('vercel'));
    const aws = data.subscriptions.find((s:any) => s.name.toLowerCase().includes('aws'));
    const github = data.subscriptions.find((s:any) => s.name.toLowerCase().includes('github'));
    
    expect(vercel.frequency).toBe('quarterly');
    expect(aws.frequency).toBe('half-yearly');
    expect(github.frequency).toBe('yearly');
  });

  it('returns 500 on unexpected error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
