import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('@/lib/prisma', () => ({
  prisma: { webhook: { findMany: vi.fn() } },
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  toLogError: vi.fn((e) => ({ message: e?.message || 'Unknown' })),
}));

import { prisma } from '@/lib/prisma';
import { fireWebhook, verifyWebhookSignature } from '@/lib/webhooks';

import { mockPrisma } from '../helpers/prisma-mock';
const mockedPrisma = mockPrisma(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret-key';

  it('verifies a valid HMAC-SHA256 signature', () => {
    const body = '{"event":"invoice.created"}';
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const body = '{"event":"invoice.created"}';
    expect(verifyWebhookSignature(body, 'invalid_hex_signature_deadbeef', secret)).toBe(false);
  });

  it('rejects tampered body', () => {
    const body = '{"event":"invoice.created"}';
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature('{"event":"invoice.deleted"}', signature, secret)).toBe(false);
  });

  it('returns false when no secret (fail-closed)', () => {
    delete process.env.WEBHOOK_SECRET;
    expect(verifyWebhookSignature('body', 'sig')).toBe(false);
  });

  it('uses env WEBHOOK_SECRET as fallback', () => {
    process.env.WEBHOOK_SECRET = 'env-secret';
    const body = 'test body';
    const sig = crypto.createHmac('sha256', 'env-secret').update(body).digest('hex');
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    delete process.env.WEBHOOK_SECRET;
  });

  it('rejects signatures of different lengths', () => {
    const body = 'test';
    expect(verifyWebhookSignature(body, 'short', secret)).toBe(false);
  });
});

describe('fireWebhook', () => {
  it('fetches matching webhook URLs with signature headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    mockedPrisma.webhook.findMany.mockResolvedValue([
      { id: 'wh-1', url: 'https://hooks.example.com/finance', events: '["invoice.created","*"]', isActive: true, secret: 'wh-secret' },
    ] as any);

    await fireWebhook('org-1', 'invoice.created', { invoiceId: 'inv-1' });

    // Give Promise.allSettled time to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.example.com/finance',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Finance-Event': 'invoice.created',
          'X-Finance-Signature': expect.any(String),
        }),
      }),
    );
  });

  it('skips webhooks that do not match the event', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    mockedPrisma.webhook.findMany.mockResolvedValue([
      { id: 'wh-1', url: 'https://hooks.example.com', events: '["expense.created"]', isActive: true, secret: 's' },
    ] as any);

    await fireWebhook('org-1', 'invoice.created', {});
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when no webhooks configured', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    mockedPrisma.webhook.findMany.mockResolvedValue([]);

    await fireWebhook('org-1', 'invoice.created', {});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles webhooks with wildcard event', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    mockedPrisma.webhook.findMany.mockResolvedValue([
      { id: 'wh-1', url: 'https://hooks.example.com', events: '["*"]', isActive: true, secret: 's' },
    ] as any);

    await fireWebhook('org-1', 'any.event', {});
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalled();
  });

  it('skips webhook when no secret configured', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    delete process.env.WEBHOOK_SECRET;

    mockedPrisma.webhook.findMany.mockResolvedValue([
      { id: 'wh-1', url: 'https://hooks.example.com', events: '["*"]', isActive: true, secret: null },
    ] as any);

    await fireWebhook('org-1', 'test', {});
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles invalid events JSON gracefully', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    mockedPrisma.webhook.findMany.mockResolvedValue([
      { id: 'wh-1', url: 'https://hooks.example.com', events: 'not-json', isActive: true, secret: 's' },
    ] as any);

    await fireWebhook('org-1', 'test', {});
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('logs error when fetch fails (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
    vi.stubGlobal('fetch', mockFetch);

    mockedPrisma.webhook.findMany.mockResolvedValue([
      { id: 'wh-1', url: 'https://hooks.example.com', events: '["*"]', isActive: true, secret: 'secret' },
    ] as any);

    // Should not throw — error is caught internally
    await fireWebhook('org-1', 'test', {});
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalled();
    // Logger should capture the dispatch failure
    const { log } = await import('@/lib/logger');
    expect(log.error).toHaveBeenCalled();
  });

  it('logs error when prisma query fails (outer catch)', async () => {
    mockedPrisma.webhook.findMany.mockRejectedValue(new Error('DB connection lost'));

    // Should not throw — error is caught internally
    await fireWebhook('org-1', 'test', {});

    const { log } = await import('@/lib/logger');
    expect(log.error).toHaveBeenCalled();
  });
});
