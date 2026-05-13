import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/ai-provider', () => ({
  parseIntentWithAI: vi.fn(),
  formatWithAI: vi.fn(),
  isGeminiConfigured: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { requireTenant } from '@/lib/tenant';
import { parseIntentWithAI, formatWithAI, isGeminiConfigured } from '@/lib/ai-provider';
import { POST } from '@/app/api/copilot/chat/route';

const mt = vi.mocked(requireTenant);
const mGemini = vi.mocked(isGeminiConfigured);
const mParseIntent = vi.mocked(parseIntentWithAI);
const mFormatAI = vi.mocked(formatWithAI);

// Mock global fetch for internal copilot query/action calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId: 'u1', organizationId: 'org-1' });
  mGemini.mockReturnValue(false);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

function req(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/copilot/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as Record<string, unknown>);
}

describe('POST /api/copilot/chat', () => {
  describe('validation', () => {
    it('returns 400 when message is missing', async () => {
      const res = await POST(req({}));
      expect(res.status).toBe(400);
    });

    it('returns 400 when message is not a string', async () => {
      const res = await POST(req({ message: 123 }));
      expect(res.status).toBe(400);
    });
  });

  describe('keyword detection (non-AI mode)', () => {
    it('detects runway query from "how long" keyword', async () => {
      const res = await POST(req({ message: 'how long will my cash last?' }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sources).toContain('getRunway');
      expect(data.aiPowered).toBe(false);
    });

    it('detects invoice query', async () => {
      const res = await POST(req({ message: 'show me all invoices' }));
      const data = await res.json();
      expect(data.sources).toContain('getInvoices');
    });

    it('detects expense query', async () => {
      const res = await POST(req({ message: 'what are my expenses' }));
      const data = await res.json();
      expect(data.sources).toContain('getExpenses');
    });

    it('detects revenue/client query', async () => {
      const res = await POST(req({ message: 'revenue by client' }));
      const data = await res.json();
      expect(data.sources).toContain('getRevenueByClient');
    });

    it('detects cash flow query', async () => {
      const res = await POST(req({ message: 'show cash flow projection' }));
      const data = await res.json();
      expect(data.sources).toContain('getCashFlowProjection');
    });

    it('detects department cost query', async () => {
      const res = await POST(req({ message: 'cost by department' }));
      const data = await res.json();
      expect(data.sources).toContain('getCostByDepartment');
    });

    it('detects health/score query', async () => {
      const res = await POST(req({ message: 'what is my financial health score' }));
      const data = await res.json();
      expect(data.sources).toContain('getFinancialHealth');
    });

    it('falls back to financial health for unknown queries', async () => {
      const res = await POST(req({ message: 'hello world' }));
      const data = await res.json();
      expect(data.sources).toContain('getFinancialHealth');
    });

    it('deduplicates matching queries', async () => {
      const res = await POST(req({ message: 'runway burn rate cash left' }));
      const data = await res.json();
      // All three map to getRunway, should only appear once
      const runwayCount = data.sources.filter((s: string) => s === 'getRunway').length;
      expect(runwayCount).toBe(1);
    });
  });

  describe('action intent detection', () => {
    it('detects email action', async () => {
      const res = await POST(req({ message: 'remind overdue clients via email' }));
      const data = await res.json();
      expect(data.action).toBeDefined();
      expect(data.action.label).toContain('Follow-up');
    });

    it('detects anomaly scan action', async () => {
      const res = await POST(req({ message: 'scan for anomalies' }));
      const data = await res.json();
      expect(data.action).toBeDefined();
      expect(data.action.url).toBe('/api/anomalies');
    });

    it('detects reconciliation action', async () => {
      const res = await POST(req({ message: 'reconcile my bank transactions' }));
      const data = await res.json();
      expect(data.action).toBeDefined();
      expect(data.action.url).toContain('reconciliation');
    });

    it('detects CFO brief action', async () => {
      const res = await POST(req({ message: 'generate cfo brief' }));
      const data = await res.json();
      expect(data.action).toBeDefined();
      expect(data.action.label).toContain('CFO Brief');
    });

    it('returns no action for generic queries', async () => {
      const res = await POST(req({ message: 'what is my runway' }));
      const data = await res.json();
      expect(data.action).toBeUndefined();
    });
  });

  describe('AI mode (Gemini configured)', () => {
    beforeEach(() => {
      mGemini.mockReturnValue(true);
    });

    it('uses AI intent parsing when configured', async () => {
      mParseIntent.mockResolvedValue({
        queries: [{ query: 'getRunway' }],
        actions: [],
        summary: 'Runway analysis'
      } as any);
      mFormatAI.mockResolvedValue('Your runway is 12 months.');

      const res = await POST(req({ message: 'how long will cash last?' }));
      const data = await res.json();
      expect(data.aiPowered).toBe(true);
      expect(data.response).toBe('Your runway is 12 months.');
    });

    it('falls back to keyword detection when AI intent returns null', async () => {
      mParseIntent.mockResolvedValue(null);
      const res = await POST(req({ message: 'show expenses' }));
      const data = await res.json();
      expect(data.sources).toContain('getExpenses');
    });

    it('falls back to template formatting when AI format returns null', async () => {
      mParseIntent.mockResolvedValue({
        queries: [{ query: 'getRunway' }],
        actions: [],
        summary: 'test'
      } as any);
      mFormatAI.mockResolvedValue(null);
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      const res = await POST(req({ message: 'runway?' }));
      const data = await res.json();
      expect(data.response).toBeDefined();
    });

    it('handles AI actions', async () => {
      mParseIntent.mockResolvedValue({
        queries: [],
        actions: [{ action: 'createInvoice', params: { amount: 5000 } }],
        summary: 'Creating invoice'
      } as any);
      mFormatAI.mockResolvedValue('Invoice created!');

      const res = await POST(req({ message: 'create an invoice for 5000' }));
      const data = await res.json();
      expect(data.response).toBeDefined();
    });
  });

  describe('response formatting (fallback)', () => {
    it('formats runway data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { runway: { runwayMonths: 12 }, mrr: 100000, arr: 1200000, burnRate: { currentMonth: 50000 } }
        }),
      });
      const res = await POST(req({ message: 'runway' }));
      const data = await res.json();
      expect(data.response).toContain('Runway');
    });

    it('formats invoice data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            invoices: [{ invoiceNumber: 'INV-001', total: 5000, client: { name: 'Client A' }, status: 'sent' }],
            summary: { total: 1, outstanding: 1, outstandingAmount: 5000 },
          }
        }),
      });
      const res = await POST(req({ message: 'invoices' }));
      const data = await res.json();
      expect(data.response).toContain('INV-001');
    });

    it('returns fallback message when no data', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      const res = await POST(req({ message: 'unknown query' }));
      const data = await res.json();
      expect(data.response).toContain("couldn't find");
    });
  });

  describe('error handling', () => {
    it('returns 500 on tenant error', async () => {
      mt.mockRejectedValue(new Error('auth fail'));
      const res = await POST(req({ message: 'test' }));
      expect(res.status).toBe(500);
    });

    it('handles fetch errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      const res = await POST(req({ message: 'invoices' }));
      expect(res.status).toBe(200);
      // Should still return a response, just with empty results
    });
  });
});
