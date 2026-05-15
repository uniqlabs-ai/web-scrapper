import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRazorpayContact, createFundAccount, executePayout } from '@/lib/payouts';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); });

describe('createRazorpayContact', () => {
  it('throws when RAZORPAYX credentials not set', async () => {
    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
    await expect(createRazorpayContact({ name: 'Test', type: 'vendor' }))
      .rejects.toThrow('RazorpayX Credentials not configured');
  });

  it('creates contact when credentials are set', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cont_123' }) });
    vi.stubGlobal('fetch', mockFetch);

    const id = await createRazorpayContact({ name: 'Vendor', type: 'vendor', email: 'v@test.com' });
    expect(id).toBe('cont_123');
    expect(mockFetch).toHaveBeenCalledWith('https://api.razorpay.com/v1/contacts', expect.objectContaining({ method: 'POST' }));

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });

  it('throws on API error', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: { description: 'Invalid contact' } }),
    }));

    await expect(createRazorpayContact({ name: 'Bad', type: 'vendor' }))
      .rejects.toThrow('Invalid contact');

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });

  it('throws on API error with unknown description', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({}),
    }));

    await expect(createRazorpayContact({ name: 'Bad', type: 'vendor' }))
      .rejects.toThrow('RazorpayX Contact Error: Unknown');

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });
});

describe('createFundAccount', () => {
  it('throws when credentials not set', async () => {
    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
    await expect(createFundAccount({ contact_id: 'c1', bank_name: 'SBI', account_number: '123', ifsc: 'SBIN0001' }))
      .rejects.toThrow('Credentials');
  });

  it('creates fund account', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'fa_123' }) }));

    const id = await createFundAccount({ contact_id: 'c1', bank_name: 'SBI', account_number: '123', ifsc: 'SBIN0001' });
    expect(id).toBe('fa_123');

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });

  it('throws on API error with unknown description', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: {} }),
    }));

    await expect(createFundAccount({ contact_id: 'c1', bank_name: 'SBI', account_number: '123', ifsc: 'SBIN0001' }))
      .rejects.toThrow('RazorpayX FundAcc Error: Unknown');

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });
});

describe('executePayout', () => {
  it('throws when credentials not set', async () => {
    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
    await expect(executePayout({ fund_account_id: 'fa1', amount: 1000, currency: 'INR', mode: 'NEFT', purpose: 'salary' }))
      .rejects.toThrow('Credentials');
  });

  it('converts amount to paise and executes payout', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'pout_123' }) });
    vi.stubGlobal('fetch', mockFetch);

    const id = await executePayout({ fund_account_id: 'fa1', amount: 1500.50, currency: 'INR', mode: 'IMPS', purpose: 'salary' });
    expect(id).toBe('pout_123');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.amount).toBe(150050); // 1500.50 * 100 = 150050 paise
    expect(body.mode).toBe('IMPS');
    expect(body.currency).toBe('INR');

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });

  it('throws on API error with description', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: { description: 'Insufficient balance' } }),
    }));

    await expect(executePayout({ fund_account_id: 'fa1', amount: 9999999, currency: 'INR', mode: 'NEFT', purpose: 'payout' }))
      .rejects.toThrow('Insufficient balance');

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });

  it('throws on API error with unknown description', async () => {
    process.env.RAZORPAYX_KEY_ID = 'test_id';
    process.env.RAZORPAYX_KEY_SECRET = 'test_secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: { some_other_field: 'hi' } }),
    }));

    await expect(executePayout({ fund_account_id: 'fa1', amount: 100, currency: 'INR', mode: 'NEFT', purpose: 'payout' }))
      .rejects.toThrow('RazorpayX Payout Error: Unknown');

    delete process.env.RAZORPAYX_KEY_ID;
    delete process.env.RAZORPAYX_KEY_SECRET;
  });
});
