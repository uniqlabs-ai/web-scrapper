import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    expense: { create: vi.fn() },
    revenue: { create: vi.fn() },
    importBatch: { create: vi.fn() },
  },
}));

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

const { mockText, mockGenerateContent, mockGetModel } = vi.hoisted(() => {
  const mockText = vi.fn().mockReturnValue(JSON.stringify({
    documentType: 'profit_and_loss',
    companyName: 'Test Corp',
    period: 'FY2024',
    lineItems: [
      { description: 'Sales', amount: 1000, type: 'revenue' },
      { description: 'Rent', amount: 500, type: 'expense' },
      { description: 'Asset', amount: 200, type: 'asset' }
    ]
  }));
  const mockGenerateContent = vi.fn().mockResolvedValue({ response: { text: mockText } });
  const mockGetModel = vi.fn().mockReturnValue({ generateContent: mockGenerateContent });
  return { mockText, mockGenerateContent, mockGetModel };
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return mockGetModel(); }
  }
}));

import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/import/pdf/route';
import { mockPrisma } from '../helpers/prisma-mock';

const mp = mockPrisma(prisma);
const mt = vi.mocked(requireTenant);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mp.user.findUnique.mockResolvedValue({ id: 'u1', organizationId: 'org-1' } as any);
  mp.importBatch.create.mockResolvedValue({ id: 'batch-1' } as any);
  process.env.GEMINI_API_KEY = 'test-key';
  
  mockText.mockReturnValue(JSON.stringify({
    documentType: 'profit_and_loss',
    companyName: 'Test Corp',
    period: 'FY2024',
    lineItems: [
      { description: 'Sales', amount: 1000, type: 'revenue' },
      { description: 'Rent', amount: 500, type: 'expense' },
      { description: 'Asset', amount: 200, type: 'asset' }
    ]
  }));
});

function makeReq(fileName: string | null): NextRequest {
  const form = new FormData();
  if (fileName) {
    const file = new File(['fake-pdf'], fileName, { type: 'application/pdf' });
    form.append('file', file);
  }
  return new NextRequest(new URL('http://localhost:3008/api/import/pdf'), {
    method: 'POST',
    body: form,
  } as Record<string, unknown>);
}

describe('POST /api/import/pdf', () => {
  it('returns 400 when no file is uploaded', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 when file is not PDF', async () => {
    const res = await POST(makeReq('image.png'));
    expect(res.status).toBe(400);
  });

  it('returns 500 when GEMINI_API_KEY is not configured', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(makeReq('doc.pdf'));
    expect(res.status).toBe(500);
  });

  it('returns 422 on invalid JSON response from Gemini', async () => {
    mockText.mockReturnValue('Not valid JSON');
    const res = await POST(makeReq('doc.pdf'));
    expect(res.status).toBe(422);
  });

  it('handles markdown wrapped JSON', async () => {
    mockText.mockReturnValue('```json\n{"lineItems": [{"amount": 100, "type": "expense"}]}\n```');
    const res = await POST(makeReq('doc.pdf'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(mp.expense.create).toHaveBeenCalled();
  });

  it('imports revenue, expense, and asset types correctly', async () => {
    const res = await POST(makeReq('financials.pdf'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    expect(data.imported).toBe(3); // 3 items in the default mock
    
    // Revenue mapped to revenue table
    expect(mp.revenue.create).toHaveBeenCalledTimes(1);
    
    // Expense and Asset mapped to expense table
    expect(mp.expense.create).toHaveBeenCalledTimes(2);
    
    expect(mp.importBatch.create).toHaveBeenCalled();
  });

  it('skips line items with 0 amount', async () => {
    mockText.mockReturnValue(JSON.stringify({
      lineItems: [
        { amount: 0, type: 'revenue' },
        { amount: null, type: 'expense' },
        { amount: 100, type: 'revenue' }
      ]
    }));
    
    const res = await POST(makeReq('doc.pdf'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
  });

  it('returns 500 on unexpected exceptions', async () => {
    mt.mockRejectedValue(new Error('Auth failed'));
    const res = await POST(makeReq('doc.pdf'));
    expect(res.status).toBe(500);
  });
});
