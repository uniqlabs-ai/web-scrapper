import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { parseIntentWithAI, formatWithAI, isGeminiConfigured } from '@/lib/ai-provider';

const origEnv = process.env.GEMINI_API_KEY;

describe('isGeminiConfigured', () => {
  afterEach(() => { process.env.GEMINI_API_KEY = origEnv; });

  it('returns true when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(isGeminiConfigured()).toBe(true);
  });

  it('returns false when GEMINI_API_KEY is not set', () => {
    delete process.env.GEMINI_API_KEY;
    expect(isGeminiConfigured()).toBe(false);
  });
});

describe('parseIntentWithAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });
  afterEach(() => { process.env.GEMINI_API_KEY = origEnv; });

  it('returns parsed intent from AI response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ queries: [{ query: 'getRunway' }], summary: 'Your runway is...' }),
      },
    });
    const result = await parseIntentWithAI('What is my runway?');
    expect(result).not.toBeNull();
    expect(result!.queries).toHaveLength(1);
    expect(result!.queries![0].query).toBe('getRunway');
  });

  it('strips markdown code fences from AI response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '```json\n{"queries":[{"query":"getExpenses"}],"summary":"expenses"}\n```',
      },
    });
    const result = await parseIntentWithAI('Show my expenses');
    expect(result).not.toBeNull();
    expect(result!.queries![0].query).toBe('getExpenses');
  });

  it('returns null when AI returns no queries or actions', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"summary":"hello"}' },
    });
    const result = await parseIntentWithAI('Hello');
    expect(result).toBeNull();
  });

  it('returns null on AI error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API quota exceeded'));
    const result = await parseIntentWithAI('test');
    expect(result).toBeNull();
  });

  it('returns null when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    // Need to clear the cached model by reimporting
    vi.resetModules();
    const { parseIntentWithAI: fresh } = await import('@/lib/ai-provider');
    const result = await fresh('test');
    expect(result).toBeNull();
  });
});

describe('formatWithAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });
  afterEach(() => { process.env.GEMINI_API_KEY = origEnv; });

  it('returns formatted string from AI', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '### Financial Overview\nYour MRR is ₹2,00,000' },
    });
    const result = await formatWithAI('How is my business?', [{ mrr: 200000 }], 'Overview');
    expect(result).toContain('Financial Overview');
  });

  it('returns null on error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('fail'));
    const result = await formatWithAI('test', [], '');
    expect(result).toBeNull();
  });
});
