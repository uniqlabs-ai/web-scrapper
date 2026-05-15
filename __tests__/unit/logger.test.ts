import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, toLogError, withDuration } from '@/lib/logger';

describe('logger', () => {
  const originalEnv = process.env.NODE_ENV;
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('logs debug when not in production', () => {
    process.env.NODE_ENV = 'development';
    log.debug('test debug', { module: 'test', action: 'test', userId: 'u1', orgId: 'o1', resourceId: 'r1', resourceType: 'type', durationMs: 10, meta: { a: 1 } });
    expect(consoleSpy.debug).toHaveBeenCalled();
  });

  it('filters sensitive keys in meta', () => {
    process.env.NODE_ENV = 'production';
    log.info('test info', { module: 'test', action: 'test', meta: { password: 'secret', nested: { token: 'hidden' }, array: [1, 2, 3] } });
    expect(consoleSpy.info).toHaveBeenCalled();
    const callArg = consoleSpy.info.mock.calls[0][0];
    expect(callArg).toContain('[REDACTED]');
    expect(callArg).not.toContain('secret');
    expect(callArg).not.toContain('hidden');
  });

  it('logs error and fatal to console.error', () => {
    log.error('test error', { module: 'test', action: 'test' });
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);

    log.fatal('test fatal', { module: 'test', action: 'test' });
    expect(consoleSpy.error).toHaveBeenCalledTimes(2);
  });

  it('logs warn to console.warn', () => {
    log.warn('test warn', { module: 'test', action: 'test' });
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
  });

  it('handles stack truncation', () => {
    const error = new Error('test');
    error.stack = 'a'.repeat(600);
    log.error('test error', { module: 'test', action: 'test', error: { message: error.message, name: error.name, stack: error.stack, digest: '123' } });
    expect(consoleSpy.error).toHaveBeenCalled();
  });

  it('toLogError converts correctly', () => {
    const err = new Error('test error');
    expect(toLogError(err).message).toBe('test error');
    
    expect(toLogError('string error').message).toBe('string error');
  });

  it('withDuration logs success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const res = await withDuration(fn, { module: 'test', action: 'test' });
    expect(res).toBe('ok');
    expect(consoleSpy.info).toHaveBeenCalled();
  });

  it('withDuration logs failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withDuration(fn, { module: 'test', action: 'test' })).rejects.toThrow('fail');
    expect(consoleSpy.error).toHaveBeenCalled();
  });
});
