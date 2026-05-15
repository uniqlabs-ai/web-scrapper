import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the actual module — no mocking needed for pure logic
import { log, toLogError, withDuration, type LogLevel } from '@/lib/logger';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('log', () => {
  it('exposes debug, info, warn, error, fatal methods', () => {
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.fatal).toBe('function');
  });

  it('log.info calls console.info', () => {
    log.info('Test message', { module: 'test', action: 'check' });
    expect(console.info).toHaveBeenCalled();
  });

  it('log.warn calls console.warn', () => {
    log.warn('Warning message', { module: 'test', action: 'check' });
    expect(console.warn).toHaveBeenCalled();
  });

  it('log.error calls console.error', () => {
    log.error('Error message', { module: 'test', action: 'check' });
    expect(console.error).toHaveBeenCalled();
  });

  it('log.fatal calls console.error', () => {
    log.fatal('Fatal message', { module: 'test', action: 'check' });
    expect(console.error).toHaveBeenCalled();
  });

  it('includes userId and orgId when provided', () => {
    log.info('Test', { module: 'test', action: 'check', userId: 'u1', orgId: 'org-1' });
    const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain('u1');
  });

  it('includes duration when provided', () => {
    log.info('Completed', { module: 'test', action: 'query', durationMs: 42 });
    const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain('42');
  });

  it('includes error details', () => {
    log.error('Failed', { module: 'test', action: 'exec', error: { message: 'DB error', name: 'PrismaError' } });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain('PrismaError');
    expect(output).toContain('DB error');
  });

  it('redacts sensitive keys in meta', () => {
    log.info('Login', { module: 'auth', action: 'login', meta: { token: 'secret123', username: 'admin' } });
    const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).not.toContain('secret123');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('admin');
  });

  it('redacts nested sensitive keys', () => {
    log.info('Test', { module: 'test', action: 'check', meta: { config: { api_key: 'abc', host: 'localhost' } } });
    const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).not.toContain('abc');
    expect(output).toContain('localhost');
  });

  it('redacts all known sensitive keys', () => {
    const sensitiveKeys = ['password', 'secret', 'authorization', 'cookie', 'jwt', 'pan', 'aadhaar', 'credentials', 'bearer'];
    for (const key of sensitiveKeys) {
      log.info('Test', { module: 'test', action: 'check', meta: { [key]: 'sensitive-value' } });
    }
    const calls = (console.info as ReturnType<typeof vi.fn>).mock.calls;
    for (const [output] of calls) {
      expect(output).not.toContain('sensitive-value');
    }
  });
});

describe('toLogError', () => {
  it('converts Error to structured shape', () => {
    const err = new TypeError('Something failed');
    const result = toLogError(err);
    expect(result.message).toBe('Something failed');
    expect(result.name).toBe('TypeError');
    expect(result.stack).toBeDefined();
  });

  it('converts non-Error to structured shape', () => {
    const result = toLogError('string error');
    expect(result.message).toBe('string error');
    expect(result.name).toBe('UnknownError');
  });

  it('handles null/undefined', () => {
    expect(toLogError(null).name).toBe('UnknownError');
    expect(toLogError(undefined).name).toBe('UnknownError');
  });
});

describe('withDuration', () => {
  it('returns result and logs duration on success', async () => {
    const result = await withDuration(
      async () => 42,
      { module: 'test', action: 'compute' },
    );
    expect(result).toBe(42);
    expect(console.info).toHaveBeenCalled();
  });

  it('rethrows and logs duration on failure', async () => {
    await expect(
      withDuration(
        async () => { throw new Error('fail'); },
        { module: 'test', action: 'compute' },
      ),
    ).rejects.toThrow('fail');
    expect(console.error).toHaveBeenCalled();
  });
});
