import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: mockGenerateContent }; }
  },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }, toLogError: vi.fn((e:any)=>({message:e?.message||'Unknown',name:'Error'})) }));

import { parseReceiptWithAI } from '@/lib/document-intelligence';

const origKey = process.env.GEMINI_API_KEY;

describe('parseReceiptWithAI', () => {
  afterEach(() => { process.env.GEMINI_API_KEY = origKey; vi.clearAllMocks(); });

  it('returns null when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    vi.resetModules();
    const { parseReceiptWithAI: fresh } = await import('@/lib/document-intelligence');
    const result = await fresh('base64data', 'image/png');
    expect(result).toBeNull();
  });

  it('parses receipt data from AI response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          vendorName: 'Starbucks', date: '2025-04-15T00:00:00.000Z', amount: 350,
          gstNumber: null, category: 'Meals', confidence: 0.92,
        }),
      },
    });
    const result = await parseReceiptWithAI('base64data', 'image/jpeg');
    expect(result).not.toBeNull();
    expect(result!.vendorName).toBe('Starbucks');
    expect(result!.amount).toBe(350);
  });

  it('strips code fences from AI response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '```json\n{"vendorName":"Amazon","date":null,"amount":1500,"gstNumber":null,"category":"Software","confidence":0.85}\n```',
      },
    });
    const result = await parseReceiptWithAI('base64data', 'image/png');
    expect(result).not.toBeNull();
    expect(result!.vendorName).toBe('Amazon');
  });

  it('returns null on AI error', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockGenerateContent.mockRejectedValue(new Error('API error'));
    const result = await parseReceiptWithAI('base64data', 'image/png');
    expect(result).toBeNull();
  });
});
