import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientLog } from '@/lib/client-logger';

describe('client-logger', () => {
  let consoleSpy: any;
  const originalEnv = process.env.NODE_ENV;

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
    if (originalEnv) vi.stubEnv('NODE_ENV', originalEnv);
  });

  it('formats errors correctly', () => {
    clientLog.error('test', 'mod', 'act', new Error('test error'));
    expect(consoleSpy.error).toHaveBeenCalled();
    expect(consoleSpy.error.mock.calls[0][0]).toContain('→ test error');

    clientLog.error('test', 'mod', 'act', 'string error');
    expect(consoleSpy.error).toHaveBeenCalledTimes(2);
    expect(consoleSpy.error.mock.calls[1][0]).toContain('→ string error');
  });

  it('logs debug when not in production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    clientLog.debug('test', 'mod', 'act');
    expect(consoleSpy.debug).toHaveBeenCalled();
    
    vi.stubEnv('NODE_ENV', 'production');
    clientLog.debug('test', 'mod', 'act');
    // Shouldn't be called again
    expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
  });

  it('logs info, warn, error', () => {
    clientLog.info('info msg', 'mod', 'act');
    expect(consoleSpy.info).toHaveBeenCalled();

    clientLog.warn('warn msg', 'mod', 'act');
    expect(consoleSpy.warn).toHaveBeenCalled();

    clientLog.error('error msg', 'mod', 'act');
    expect(consoleSpy.error).toHaveBeenCalled();
  });
});
