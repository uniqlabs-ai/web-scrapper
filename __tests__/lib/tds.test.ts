import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TDS_SECTIONS,
  TDS_QUARTERS,
  calculateTDS,
  getSectionForExpenseType,
  getCurrentQuarter,
} from '@/lib/tds';

// ── TDS_SECTIONS data integrity ──────────────────────────────────────

describe('TDS_SECTIONS', () => {
  it('contains 12 section entries', () => {
    expect(TDS_SECTIONS).toHaveLength(12);
  });

  it('every section has required fields with valid types', () => {
    for (const s of TDS_SECTIONS) {
      expect(s.section).toBeTruthy();
      expect(typeof s.description).toBe('string');
      expect(s.rate).toBeGreaterThanOrEqual(0);
      expect(s.threshold).toBeGreaterThan(0);
      expect(s.panAbsentRate).toBeGreaterThan(0);
    }
  });

  it('has unique section+description combinations', () => {
    const keys = TDS_SECTIONS.map((s) => `${s.section}|${s.description}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('panAbsentRate is always >= rate', () => {
    for (const s of TDS_SECTIONS) {
      expect(s.panAbsentRate).toBeGreaterThanOrEqual(s.rate);
    }
  });
});

// ── calculateTDS ─────────────────────────────────────────────────────

describe('calculateTDS', () => {
  describe('with PAN (default)', () => {
    it('calculates 194J(b) at 10% for professional fees', () => {
      const result = calculateTDS(100000, '194J(b)');
      expect(result.tdsRate).toBe(10);
      expect(result.tdsAmount).toBe(10000);
      expect(result.netPayable).toBe(90000);
      expect(result.grossAmount).toBe(100000);
      expect(result.hasPAN).toBe(true);
    });

    it('calculates 194C at 1% for contractor (individuals)', () => {
      const result = calculateTDS(50000, '194C');
      expect(result.tdsRate).toBe(1);
      expect(result.tdsAmount).toBe(500);
      expect(result.netPayable).toBe(49500);
    });

    it('calculates 194H at 5% for commission', () => {
      const result = calculateTDS(20000, '194H');
      expect(result.tdsRate).toBe(5);
      expect(result.tdsAmount).toBe(1000);
      expect(result.netPayable).toBe(19000);
    });

    it('calculates 194I(b) at 10% for rent', () => {
      const result = calculateTDS(300000, '194I(b)');
      expect(result.tdsRate).toBe(10);
      expect(result.tdsAmount).toBe(30000);
      expect(result.netPayable).toBe(270000);
    });

    it('calculates 194Q at 0.1% for purchase of goods', () => {
      const result = calculateTDS(10000000, '194Q');
      expect(result.tdsRate).toBe(0.1);
      expect(result.tdsAmount).toBe(10000);
      expect(result.netPayable).toBe(9990000);
    });

    it('calculates 194S at 1% for crypto', () => {
      const result = calculateTDS(500000, '194S');
      expect(result.tdsRate).toBe(1);
      expect(result.tdsAmount).toBe(5000);
      expect(result.netPayable).toBe(495000);
    });
  });

  describe('without PAN', () => {
    it('applies 20% fallback rate for 194J(b)', () => {
      const result = calculateTDS(100000, '194J(b)', false);
      expect(result.tdsRate).toBe(20);
      expect(result.tdsAmount).toBe(20000);
      expect(result.netPayable).toBe(80000);
      expect(result.hasPAN).toBe(false);
    });

    it('applies 5% fallback rate for 194Q (exception to 20% rule)', () => {
      const result = calculateTDS(10000000, '194Q', false);
      expect(result.tdsRate).toBe(5);
      expect(result.tdsAmount).toBe(500000);
      expect(result.netPayable).toBe(9500000);
    });

    it('applies 20% for 194C without PAN', () => {
      const result = calculateTDS(50000, '194C', false);
      expect(result.tdsRate).toBe(20);
      expect(result.tdsAmount).toBe(10000);
      expect(result.netPayable).toBe(40000);
    });
  });

  describe('unknown section', () => {
    it('returns zero TDS and full amount as netPayable', () => {
      const result = calculateTDS(100000, 'UNKNOWN_SECTION');
      expect(result.tdsRate).toBe(0);
      expect(result.tdsAmount).toBe(0);
      expect(result.netPayable).toBe(100000);
      expect(result.section).toBe('UNKNOWN_SECTION');
    });
  });

  describe('rounding', () => {
    it('rounds TDS amount to nearest integer', () => {
      // 33333 * 10 / 100 = 3333.3 → rounds to 3333
      const result = calculateTDS(33333, '194J(b)');
      expect(Number.isInteger(result.tdsAmount)).toBe(true);
      expect(result.tdsAmount).toBe(3333);
    });

    it('rounds correctly for small amounts', () => {
      // 150 * 1 / 100 = 1.5 → rounds to 2
      const result = calculateTDS(150, '194C');
      expect(Number.isInteger(result.tdsAmount)).toBe(true);
      expect(result.tdsAmount).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles zero amount', () => {
      const result = calculateTDS(0, '194J(b)');
      expect(result.tdsAmount).toBe(0);
      expect(result.netPayable).toBe(0);
    });

    it('preserves section in output', () => {
      const result = calculateTDS(1000, '194A');
      expect(result.section).toBe('194A');
    });
  });
});

// ── getSectionForExpenseType ──────────────────────────────────────────

describe('getSectionForExpenseType', () => {
  it.each([
    ['Professional Services', '194J(b)'],
    ['Legal', '194J(b)'],
    ['Consulting', '194J(b)'],
    ['Rent', '194I(b)'],
    ['Office Rent', '194I(b)'],
    ['Infrastructure Rent', '194I(a)'],
    ['Commission', '194H'],
    ['Contractor', '194C'],
    ['Interest', '194A'],
    ['Technical Services', '194J(a)'],
    ['Software Development', '194J(a)'],
  ])('maps "%s" → "%s"', (type, expectedSection) => {
    expect(getSectionForExpenseType(type)).toBe(expectedSection);
  });

  it('returns null for unknown expense types', () => {
    expect(getSectionForExpenseType('Travel')).toBeNull();
    expect(getSectionForExpenseType('Food & Meals')).toBeNull();
    expect(getSectionForExpenseType('')).toBeNull();
    expect(getSectionForExpenseType('random-string')).toBeNull();
  });
});

// ── TDS_QUARTERS ─────────────────────────────────────────────────────

describe('TDS_QUARTERS', () => {
  it('contains 4 quarters', () => {
    expect(TDS_QUARTERS).toHaveLength(4);
  });

  it('each quarter has quarter label, months, and dueDate', () => {
    for (const q of TDS_QUARTERS) {
      expect(q.quarter).toMatch(/^Q[1-4]$/);
      expect(q.months).toBeTruthy();
      expect(q.dueDate).toBeTruthy();
    }
  });

  it('quarters are in fiscal year order (Apr-Mar)', () => {
    expect(TDS_QUARTERS[0].quarter).toBe('Q1');
    expect(TDS_QUARTERS[0].months).toBe('Apr-Jun');
    expect(TDS_QUARTERS[3].quarter).toBe('Q4');
    expect(TDS_QUARTERS[3].months).toBe('Jan-Mar');
  });
});

// ── getCurrentQuarter ────────────────────────────────────────────────

describe('getCurrentQuarter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Q1 for April (month index 3)', () => {
    vi.setSystemTime(new Date(2026, 3, 15)); // April 15
    const result = getCurrentQuarter();
    expect(result.quarter).toBe('Q1');
    expect(result.startMonth).toBe(3);
    expect(result.endMonth).toBe(5);
  });

  it('returns Q1 for June (month index 5)', () => {
    vi.setSystemTime(new Date(2026, 5, 30)); // June 30
    expect(getCurrentQuarter().quarter).toBe('Q1');
  });

  it('returns Q2 for July (month index 6)', () => {
    vi.setSystemTime(new Date(2026, 6, 1)); // July 1
    const result = getCurrentQuarter();
    expect(result.quarter).toBe('Q2');
    expect(result.startMonth).toBe(6);
    expect(result.endMonth).toBe(8);
  });

  it('returns Q2 for September (month index 8)', () => {
    vi.setSystemTime(new Date(2026, 8, 15)); // Sep 15
    expect(getCurrentQuarter().quarter).toBe('Q2');
  });

  it('returns Q3 for October (month index 9)', () => {
    vi.setSystemTime(new Date(2026, 9, 1)); // Oct 1
    const result = getCurrentQuarter();
    expect(result.quarter).toBe('Q3');
    expect(result.startMonth).toBe(9);
    expect(result.endMonth).toBe(11);
  });

  it('returns Q3 for December (month index 11)', () => {
    vi.setSystemTime(new Date(2026, 11, 25)); // Dec 25
    expect(getCurrentQuarter().quarter).toBe('Q3');
  });

  it('returns Q4 for January (month index 0)', () => {
    vi.setSystemTime(new Date(2027, 0, 10)); // Jan 10
    const result = getCurrentQuarter();
    expect(result.quarter).toBe('Q4');
    expect(result.startMonth).toBe(0);
    expect(result.endMonth).toBe(2);
  });

  it('returns Q4 for March (month index 2)', () => {
    vi.setSystemTime(new Date(2027, 2, 31)); // Mar 31
    expect(getCurrentQuarter().quarter).toBe('Q4');
  });

  it('returns Q4 for February (month index 1)', () => {
    vi.setSystemTime(new Date(2027, 1, 14)); // Feb 14
    expect(getCurrentQuarter().quarter).toBe('Q4');
  });
});
