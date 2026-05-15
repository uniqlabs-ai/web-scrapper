import { describe, it, expect } from 'vitest';
import {
  CURRENCIES,
  STATIC_RATES,
  convertToINR,
  convertFromINR,
  formatCurrency,
  formatCompact,
  getSymbol,
  calculateFxGainLoss,
} from '@/lib/currency';

describe('CURRENCIES', () => {
  it('contains 10 currencies', () => {
    expect(CURRENCIES).toHaveLength(10);
  });

  it('has INR as first currency', () => {
    expect(CURRENCIES[0].code).toBe('INR');
    expect(CURRENCIES[0].symbol).toBe('₹');
  });

  it('every currency has required fields', () => {
    for (const c of CURRENCIES) {
      expect(c.code).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.symbol).toBeTruthy();
      expect(c.locale).toBeTruthy();
    }
  });
});

describe('STATIC_RATES', () => {
  it('has INR rate of 1', () => {
    expect(STATIC_RATES.INR).toBe(1);
  });

  it('has all 10 currencies with positive rates', () => {
    expect(Object.keys(STATIC_RATES)).toHaveLength(10);
    for (const rate of Object.values(STATIC_RATES)) {
      expect(rate).toBeGreaterThan(0);
    }
  });
});

describe('convertToINR', () => {
  it('returns same amount for INR', () => {
    expect(convertToINR(1000, 'INR')).toBe(1000);
  });

  it('converts USD to INR using static rate', () => {
    const result = convertToINR(100, 'USD');
    expect(result).toBe(8350); // 100 * 83.5
  });

  it('uses custom rate when provided', () => {
    const result = convertToINR(100, 'USD', 85);
    expect(result).toBe(8500);
  });

  it('falls back to 1 for unknown currency', () => {
    const result = convertToINR(100, 'XYZ');
    expect(result).toBe(100);
  });

  it('rounds to 2 decimal places', () => {
    const result = convertToINR(33.33, 'USD');
    expect(result).toBe(2783.06); // 33.33 * 83.5 = 2783.055
  });
});

describe('convertFromINR', () => {
  it('returns same amount for INR', () => {
    expect(convertFromINR(1000, 'INR')).toBe(1000);
  });

  it('converts INR to USD', () => {
    const result = convertFromINR(8350, 'USD');
    expect(result).toBe(100); // 8350 / 83.5
  });

  it('uses custom rate', () => {
    const result = convertFromINR(8500, 'USD', 85);
    expect(result).toBe(100);
  });

  it('rounds to 2 decimal places', () => {
    const result = convertFromINR(1000, 'USD');
    // 1000 / 83.5 = 11.9760...
    expect(result).toBe(11.98);
  });
});

describe('formatCurrency', () => {
  it('formats INR with Indian locale (default)', () => {
    const result = formatCurrency(1234567, 'INR');
    expect(result).toContain('12,34,567');
  });

  it('formats USD with US locale', () => {
    const result = formatCurrency(1234567, 'USD');
    expect(result).toContain('1,234,567');
  });

  it('respects decimal option', () => {
    const result = formatCurrency(1234.56, 'INR', { decimals: 2 });
    expect(result).toContain('1,234.56');
  });

  it('handles unknown currency gracefully', () => {
    const result = formatCurrency(100, 'XYZ');
    expect(result).toBeTruthy();
  });
});

describe('formatCompact', () => {
  describe('INR (Indian notation)', () => {
    it('formats crores', () => {
      expect(formatCompact(15000000, 'INR')).toBe('₹1.5Cr');
    });

    it('formats lakhs', () => {
      expect(formatCompact(250000, 'INR')).toBe('₹2.5L');
    });

    it('formats thousands', () => {
      expect(formatCompact(5000, 'INR')).toBe('₹5K');
    });

    it('formats small amounts without suffix', () => {
      expect(formatCompact(500, 'INR')).toBe('₹500');
    });

    it('handles negative amounts', () => {
      expect(formatCompact(-1500000, 'INR')).toBe('-₹15.0L');
    });
  });

  describe('USD (Western notation)', () => {
    it('formats billions', () => {
      expect(formatCompact(2500000000, 'USD')).toBe('$2.5B');
    });

    it('formats millions', () => {
      expect(formatCompact(1500000, 'USD')).toBe('$1.5M');
    });

    it('formats thousands', () => {
      expect(formatCompact(5000, 'USD')).toBe('$5K');
    });
  });
});

describe('getSymbol', () => {
  it('returns ₹ for INR', () => {
    expect(getSymbol('INR')).toBe('₹');
  });

  it('returns $ for USD', () => {
    expect(getSymbol('USD')).toBe('$');
  });

  it('returns code for unknown currency', () => {
    expect(getSymbol('XYZ')).toBe('XYZ');
  });

  it('defaults to INR when no code given', () => {
    expect(getSymbol()).toBe('₹');
  });
});

describe('calculateFxGainLoss', () => {
  it('detects gain when rate increases', () => {
    const result = calculateFxGainLoss(1000, 80, 85);
    expect(result.gainLoss).toBe(5000); // 1000 * (85-80)
    expect(result.isGain).toBe(true);
    expect(result.percentage).toBeGreaterThan(0);
  });

  it('detects loss when rate decreases', () => {
    const result = calculateFxGainLoss(1000, 85, 80);
    expect(result.gainLoss).toBe(-5000);
    expect(result.isGain).toBe(false);
    expect(result.percentage).toBeLessThan(0);
  });

  it('returns zero for unchanged rate', () => {
    const result = calculateFxGainLoss(1000, 83, 83);
    expect(result.gainLoss).toBe(0);
    expect(result.isGain).toBe(true);
    expect(result.percentage).toBe(0);
  });

  it('handles zero original rate', () => {
    const result = calculateFxGainLoss(1000, 0, 85);
    expect(result.percentage).toBe(0); // avoid division by zero
  });

  it('rounds percentage to 2 decimal places', () => {
    const result = calculateFxGainLoss(100, 83, 84);
    // (100 * 84 - 100 * 83) / (100 * 83) = 100/8300 = 1.2048...
    expect(result.percentage).toBe(1.2);
  });
});
