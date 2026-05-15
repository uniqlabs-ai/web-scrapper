import { describe, it, expect } from 'vitest';
import {
  isValidGSTRate,
  calculateGST,
  calculateLineItemTotal,
  validateGSTNumber,
  formatCurrency,
} from '@/lib/gst';

describe('isValidGSTRate', () => {
  it.each([0, 5, 12, 18, 28])('accepts valid rate %d', (rate) => {
    expect(isValidGSTRate(rate)).toBe(true);
  });

  it.each([1, 3, 7, 10, 15, 20, 25, 30, -5, 100])('rejects invalid rate %d', (rate) => {
    expect(isValidGSTRate(rate)).toBe(false);
  });
});

describe('calculateGST', () => {
  describe('intra-state (CGST + SGST)', () => {
    it('splits 18% GST equally into CGST and SGST', () => {
      const result = calculateGST(10000, 18, false);
      expect(result.subtotal).toBe(10000);
      expect(result.cgst).toBe(900);
      expect(result.sgst).toBe(900);
      expect(result.igst).toBe(0);
      expect(result.total).toBe(11800);
    });

    it('handles 5% GST split correctly', () => {
      const result = calculateGST(1000, 5, false);
      expect(result.cgst).toBe(25);
      expect(result.sgst).toBe(25);
      expect(result.total).toBe(1050);
    });

    it('handles 28% GST', () => {
      const result = calculateGST(5000, 28, false);
      expect(result.cgst).toBe(700);
      expect(result.sgst).toBe(700);
      expect(result.total).toBe(6400);
    });

    it('handles 0% GST', () => {
      const result = calculateGST(1000, 0, false);
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.total).toBe(1000);
    });

    it('rounds half-tax to 2 decimal places', () => {
      const result = calculateGST(999, 5, false);
      // 999 * 0.05 = 49.95, half = 24.975 → rounded to 24.98
      expect(result.cgst).toBe(24.98);
      expect(result.sgst).toBe(24.98);
    });
  });

  describe('inter-state (IGST)', () => {
    it('applies full tax as IGST', () => {
      const result = calculateGST(10000, 18, true);
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.igst).toBe(1800);
      expect(result.total).toBe(11800);
    });

    it('handles 12% IGST', () => {
      const result = calculateGST(2500, 12, true);
      expect(result.igst).toBe(300);
      expect(result.total).toBe(2800);
    });
  });

  it('handles zero amount', () => {
    const result = calculateGST(0, 18, false);
    expect(result.total).toBe(0);
    expect(result.cgst).toBe(0);
  });
});

describe('calculateLineItemTotal', () => {
  it('computes amount from quantity × unitPrice and applies GST', () => {
    const result = calculateLineItemTotal(5, 2000, 18, false);
    expect(result.amount).toBe(10000);
    expect(result.quantity).toBe(5);
    expect(result.unitPrice).toBe(2000);
    expect(result.cgst).toBe(900);
    expect(result.sgst).toBe(900);
    expect(result.total).toBe(11800);
  });

  it('handles fractional quantities', () => {
    const result = calculateLineItemTotal(2.5, 100, 18, true);
    expect(result.amount).toBe(250);
    expect(result.igst).toBe(45);
    expect(result.total).toBe(295);
  });

  it('rounds amount to 2 decimal places', () => {
    const result = calculateLineItemTotal(3, 33.33, 0, false);
    expect(result.amount).toBe(99.99);
  });
});

describe('validateGSTNumber', () => {
  it('accepts valid GST numbers', () => {
    expect(validateGSTNumber('27AAPFU0939F1ZV')).toBe(true);
    expect(validateGSTNumber('29ABCDE1234F1Z5')).toBe(true);
  });

  it('rejects invalid GST numbers', () => {
    expect(validateGSTNumber('INVALID')).toBe(false);
    expect(validateGSTNumber('')).toBe(false);
    expect(validateGSTNumber('27AAPFU0939F1Z')).toBe(false); // too short
    expect(validateGSTNumber('27AAPFU0939F1ZVV')).toBe(false); // too long
  });

  it('is case-insensitive', () => {
    expect(validateGSTNumber('27aapfu0939f1zv')).toBe(true);
  });
});

describe('formatCurrency', () => {
  it('formats INR with Indian locale', () => {
    const result = formatCurrency(1234567.89);
    expect(result).toContain('12,34,567.89');
  });

  it('formats USD', () => {
    const result = formatCurrency(1000, 'USD');
    expect(result).toContain('1,000.00');
  });

  it('handles zero', () => {
    const result = formatCurrency(0);
    expect(result).toContain('0.00');
  });

  it('handles negative amounts', () => {
    const result = formatCurrency(-500);
    expect(result).toContain('500.00');
  });
});
