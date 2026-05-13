import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tenant', () => ({ requireTenant: vi.fn(), TenantError: class extends Error { constructor(m:string){super(m);this.name='TenantError'} } }));
vi.mock('@/lib/ai-provider', () => ({
  parseIntentWithAI: vi.fn(),
  formatWithAI: vi.fn(),
  isGeminiConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));
vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(), requireUser: vi.fn(), getSessionUser: vi.fn(), getOrCreateSessionUser: vi.fn(), getUserId: vi.fn() }));

import { requireTenant } from '@/lib/tenant';
import { POST } from '@/app/api/copilot/chat/route';

const mt = vi.mocked(requireTenant);

// Mock global fetch for the internal API calls
const origFetch = global.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  mt.mockResolvedValue({ userId:'u1', organizationId:'org-1' });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { score: 75, status: 'Good', health: { runway: 12, profitMargin: 15 }, recommendations: [] } }),
  });
});
afterEach(() => { global.fetch = origFetch; });

import { afterEach } from 'vitest';

function req(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3008/api/copilot/chat'), {
    method:'POST', body:JSON.stringify(body), headers:{'Content-Type':'application/json'},
  });
}

describe('POST /api/copilot/chat', () => {
  it('returns 400 when message is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('processes runway query via keyword fallback', async () => {
    const res = await POST(req({ message: 'What is my runway?' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.response).toBeDefined();
    expect(d.sources).toContain('getRunway');
  });

  it('detects invoice-related queries', async () => {
    const res = await POST(req({ message: 'Show me unpaid invoices' }));
    const d = await res.json();
    expect(d.sources).toContain('getInvoices');
  });

  it('detects expense queries', async () => {
    const res = await POST(req({ message: 'What are my expenses this month?' }));
    const d = await res.json();
    expect(d.sources).toContain('getExpenses');
  });

  it('falls back to financial health for unknown queries', async () => {
    const res = await POST(req({ message: 'Hello there' }));
    const d = await res.json();
    expect(d.sources).toContain('getFinancialHealth');
  });

  it('detects action intents (email)', async () => {
    const res = await POST(req({ message: 'email overdue invoices' }));
    const d = await res.json();
    expect(d.action).toBeDefined();
    expect(d.action.label).toContain('Follow-up');
  });

  it('detects action intents (reconcile)', async () => {
    const res = await POST(req({ message: 'reconcile bank transactions' }));
    const d = await res.json();
    expect(d.action).toBeDefined();
    expect(d.action.label).toContain('Reconciliation');
  });

  it('returns 500 on error', async () => {
    mt.mockRejectedValue(new Error('fail'));
    const res = await POST(req({ message: 'test' }));
    expect(res.status).toBe(500);
  });
});
