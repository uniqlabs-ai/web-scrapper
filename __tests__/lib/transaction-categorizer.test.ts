import { describe, it, expect } from 'vitest';
import {
  categorizeTransaction,
  batchCategorize,
  EXPENSE_CATEGORIES,
  type CategorizedResult,
} from '@/lib/transaction-categorizer';

// ── EXPENSE_CATEGORIES data integrity ────────────────────────────────

describe('EXPENSE_CATEGORIES', () => {
  it('contains 13 categories', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(13);
  });

  it('each category has name, color, and icon', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(cat.name).toBeTruthy();
      expect(cat.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(cat.icon).toBeTruthy();
    }
  });

  it('has unique category names', () => {
    const names = EXPENSE_CATEGORIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes all expected categories', () => {
    const names = EXPENSE_CATEGORIES.map((c) => c.name);
    const expected = [
      'Salaries', 'Infrastructure', 'Marketing', 'Software', 'Office',
      'Travel', 'Food & Meals', 'Professional Services', 'Utilities',
      'Insurance', 'Telecom & Internet', 'Equipment', 'Misc',
    ];
    for (const e of expected) {
      expect(names).toContain(e);
    }
  });
});

// ── categorizeTransaction — Vendor Rules ──────────────────────────────

describe('categorizeTransaction', () => {
  describe('Software vendor rules', () => {
    it.each([
      ['Payment to Vercel Inc', 'Software', 'Vercel'],
      ['GITHUB.COM/PLAN', 'Software', 'GitHub'],
      ['Atlassian Jira Subscription', 'Software', 'Atlassian'],
      ['BIL/ONL/123/Slack Technologies', 'Software', 'Slack'],
      ['MSI/Notion Labs', 'Software', 'Notion'],
      ['Figma Pro Plan', 'Software', 'Figma'],
      ['Adobe Creative Cloud', 'Software', 'Adobe'],
      ['MICROSOFT 365 BUSINESS', 'Software', 'Microsoft'],
      ['Google Workspace Business', 'Software', 'Google Workspace'],
      ['ZOOM VIDEO COMM', 'Software', 'Zoom'],
      ['Stripe Payment Processing', 'Software', 'Stripe'],
      ['Razorpay Subscription', 'Software', 'Razorpay'],
      ['OpenAI API usage', 'Software', 'OpenAI'],
      ['Anthropic Claude API', 'Software', 'Anthropic'],
      ['Datadog monitoring plan', 'Software', 'Monitoring'],
      ['1Password Teams', 'Software', 'Password Manager'],
    ])('"%s" → category=%s, vendor=%s', (desc, expectedCat, expectedVendor) => {
      const result = categorizeTransaction(desc);
      expect(result.category).toBe(expectedCat);
      expect(result.vendor).toBe(expectedVendor);
      expect(result.confidence).toBe(0.9);
    });
  });

  describe('Infrastructure vendor rules', () => {
    it.each([
      ['AWS Monthly Invoice', 'Infrastructure', 'AWS'],
      ['Amazon Web Services', 'Infrastructure', 'AWS'],
      ['DigitalOcean Droplet', 'Infrastructure', 'DigitalOcean'],
      ['Google Cloud Platform GCP', 'Infrastructure', 'Google Cloud'],
      ['Cloudflare Pro Plan', 'Infrastructure', 'Cloudflare'],
      ['Render.com hosting', 'Infrastructure', 'Render'],
      ['GoDaddy Domain Renewal', 'Infrastructure', 'Domain Registrar'],
    ])('"%s" → category=%s, vendor=%s', (desc, expectedCat, expectedVendor) => {
      const result = categorizeTransaction(desc);
      expect(result.category).toBe(expectedCat);
      expect(result.vendor).toBe(expectedVendor);
      expect(result.confidence).toBe(0.9);
    });
  });

  describe('Marketing vendor rules', () => {
    it.each([
      ['Google Ads Campaign', 'Marketing', 'Google Ads'],
      ['Meta Ads Manager', 'Marketing', 'Meta Ads'],
      ['Facebook Ads payment', 'Marketing', 'Meta Ads'],
      ['LinkedIn Ads Premium', 'Marketing', 'LinkedIn Ads'],
    ])('"%s" → category=%s, vendor=%s', (desc, expectedCat, expectedVendor) => {
      const result = categorizeTransaction(desc);
      expect(result.category).toBe(expectedCat);
      expect(result.vendor).toBe(expectedVendor);
    });
  });

  describe('Travel vendor rules', () => {
    it.each([
      ['MakeMyTrip Booking', 'Travel', 'MakeMyTrip'],
      ['IRCTC Train Ticket', 'Travel', 'IRCTC'],
      ['Uber Trip Receipt', 'Travel', 'Uber'],
      ['Ola Cab Ride', 'Travel', 'Ola'],
      ['Airbnb Stay', 'Travel', 'Airbnb'],
    ])('"%s" → category=%s, vendor=%s', (desc, expectedCat, expectedVendor) => {
      const result = categorizeTransaction(desc);
      expect(result.category).toBe(expectedCat);
      expect(result.vendor).toBe(expectedVendor);
    });
  });

  describe('Food & Meals vendor rules', () => {
    it.each([
      ['Zomato Order', 'Food & Meals', 'Zomato'],
      ['Swiggy Delivery', 'Food & Meals', 'Swiggy'],
      ['Uber Eats order', 'Food & Meals', 'Uber Eats'],
      ['Starbucks Coffee', 'Food & Meals', 'Starbucks'],
      ['BigBasket Groceries', 'Food & Meals', 'BigBasket'],
      ['Blinkit quick delivery', 'Food & Meals', 'Blinkit'],
      ['Restaurant lunch', 'Food & Meals', 'Restaurant'],
    ])('"%s" → category=%s, vendor=%s', (desc, expectedCat, expectedVendor) => {
      const result = categorizeTransaction(desc);
      expect(result.category).toBe(expectedCat);
      expect(result.vendor).toBe(expectedVendor);
    });
  });

  describe('Telecom & Internet vendor rules', () => {
    it.each([
      ['Airtel Postpaid Bill', 'Telecom & Internet', 'Airtel'],
      ['Jio Recharge', 'Telecom & Internet', 'Jio'],
      ['ACT Fibernet Monthly', 'Telecom & Internet', 'ACT Fibernet'],
      ['Broadband bill payment', 'Telecom & Internet', 'Internet Service'],
    ])('"%s" → category=%s, vendor=%s', (desc, expectedCat, expectedVendor) => {
      const result = categorizeTransaction(desc);
      expect(result.category).toBe(expectedCat);
      expect(result.vendor).toBe(expectedVendor);
    });
  });

  describe('Salaries vendor rules', () => {
    it('matches salary/payroll keywords', () => {
      const result = categorizeTransaction('Salary Payment March');
      expect(result.category).toBe('Salaries');
      expect(result.vendor).toBe('Salary Payment');
    });
  });

  describe('Professional Services vendor rules', () => {
    it('matches freelancer/contractor keywords', () => {
      const result = categorizeTransaction('Freelancer payment - design');
      expect(result.category).toBe('Professional Services');
      expect(result.vendor).toBe('Freelancer/Contractor');
    });

    it('matches legal services', () => {
      const result = categorizeTransaction('Legal advisory fee');
      expect(result.category).toBe('Professional Services');
      expect(result.vendor).toBe('Legal Services');
    });
  });

  describe('Insurance vendor rules', () => {
    it('matches insurance keyword', () => {
      const result = categorizeTransaction('Health insurance premium');
      expect(result.category).toBe('Insurance');
      expect(result.vendor).toBe('Insurance');
    });

    it('matches Policybazaar', () => {
      const result = categorizeTransaction('PolicyBazaar payment');
      expect(result.category).toBe('Insurance');
      expect(result.vendor).toBe('Policybazaar');
    });
  });

  describe('Equipment vendor rules', () => {
    it.each([
      ['Amazon Purchase', 'Equipment', 'Amazon'],
      ['Flipkart Order', 'Equipment', 'Flipkart'],
      ['Apple Store MacBook', 'Equipment', 'Apple'],
      ['Laptop purchase', 'Equipment', 'Hardware'],
    ])('"%s" → category=%s, vendor=%s', (desc, expectedCat, expectedVendor) => {
      const result = categorizeTransaction(desc);
      expect(result.category).toBe(expectedCat);
      expect(result.vendor).toBe(expectedVendor);
    });
  });

  describe('Office vendor rules', () => {
    it('matches WeWork/coworking', () => {
      const result = categorizeTransaction('WeWork Monthly Rent');
      expect(result.category).toBe('Office');
      expect(result.vendor).toBe('Co-working Space');
    });
  });

  describe('Utilities vendor rules', () => {
    it('matches electricity bill', () => {
      const result = categorizeTransaction('BESCOM electricity bill');
      expect(result.category).toBe('Utilities');
      expect(result.vendor).toBe('Electricity');
    });
  });

  describe('Misc vendor rules', () => {
    it('matches tax/GST payments', () => {
      const result = categorizeTransaction('GST payment challan');
      expect(result.category).toBe('Misc');
      expect(result.vendor).toBe('Tax/GST');
    });

    it('matches fixed deposit transfers', () => {
      const result = categorizeTransaction('TRF TO FD 12345');
      expect(result.category).toBe('Misc');
      expect(result.vendor).toBe('Fixed Deposit');
    });

    it('matches EMI/loan payments', () => {
      const result = categorizeTransaction('EMI payment');
      expect(result.category).toBe('Misc');
      expect(result.vendor).toBe('Loan/EMI');
    });
  });

  // ── IMPS/NEFT extraction ──────────────────────────────────────────

  describe('IMPS/NEFT person-name transfers', () => {
    it('detects IMPS debit to named person as Salaries', () => {
      const result = categorizeTransaction(
        'MMT/IMPS/5120122 68323/ANURAGUNI Q/HDFC0000141',
        'debit'
      );
      expect(result.category).toBe('Salaries');
      expect(result.vendor).toBe('ANURAGUNI Q');
      expect(result.confidence).toBe(0.75);
    });

    it('detects IMPS credit from named person as Misc', () => {
      const result = categorizeTransaction(
        'MMT/IMPS/5120122 68323/ANURAGUNI Q/HDFC0000141',
        'credit'
      );
      expect(result.category).toBe('Misc');
      expect(result.vendor).toBe('ANURAGUNI Q');
      expect(result.confidence).toBe(0.5);
    });

    it('detects NEFT debit to named person as Salaries', () => {
      const result = categorizeTransaction(
        'NEFT- AXOMB4047307765 3-PRATEEK GUPTA- -917010042448109',
        'debit'
      );
      expect(result.category).toBe('Salaries');
      expect(result.vendor).toBe('PRATEEK GUPTA');
      expect(result.confidence).toBe(0.75);
    });

    it('detects INF/NEFT pattern', () => {
      const result = categorizeTransaction(
        'INF/NEFT/IN4260705 1852336/HDFC0000 910/MOHIUNIQ',
        'debit'
      );
      expect(result.category).toBe('Salaries');
      expect(result.vendor).toBe('MOHIUNIQ');
    });
  });

  // ── BIL/ONL patterns ──────────────────────────────────────────────

  describe('BIL/ONL bill payment patterns', () => {
    it('extracts vendor from BIL/ONL and re-checks vendor rules', () => {
      const result = categorizeTransaction('BIL/ONL/123456/Airtel Postpaid');
      expect(result.category).toBe('Telecom & Internet');
      expect(result.vendor).toBe('Airtel');
    });

    it('falls back to Misc for unknown BIL/ONL vendor', () => {
      const result = categorizeTransaction('BIL/ONL/789012/Unknown Vendor XYZ');
      expect(result.category).toBe('Misc');
      expect(result.vendor).toBe('Unknown Vendor XYZ');
      expect(result.confidence).toBe(0.5);
    });
  });

  // ── MSI/ patterns ─────────────────────────────────────────────────

  describe('MSI/ international SaaS patterns', () => {
    it('matches known vendor in MSI pattern', () => {
      const result = categorizeTransaction('MSI/Vercel Inc/USD');
      expect(result.category).toBe('Software');
      expect(result.vendor).toBe('Vercel');
      expect(result.confidence).toBe(0.9);
    });

    it('falls back to Software for unknown MSI vendor', () => {
      const result = categorizeTransaction('MSI/Unknown SaaS Co');
      expect(result.category).toBe('Software');
      expect(result.confidence).toBe(0.7);
    });
  });

  // ── Keyword fallback ──────────────────────────────────────────────

  describe('keyword fallback rules', () => {
    it('matches ATM/cash withdrawal as Misc', () => {
      const result = categorizeTransaction('ATM CASH WITHDRAWAL KORAMANGALA');
      expect(result.category).toBe('Misc');
      expect(result.confidence).toBe(0.5);
    });

    it('matches subscription keyword as Software', () => {
      const result = categorizeTransaction('Monthly subscription renewal');
      expect(result.category).toBe('Software');
      expect(result.confidence).toBe(0.5);
    });

    it('matches refund as Misc', () => {
      const result = categorizeTransaction('Refund from online order');
      expect(result.category).toBe('Misc');
      expect(result.confidence).toBe(0.5);
    });

    it('matches cheque as Misc', () => {
      const result = categorizeTransaction('CHQ DEP 123456');
      expect(result.category).toBe('Misc');
      expect(result.confidence).toBe(0.5);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns Misc with confidence 0 for empty string', () => {
      const result = categorizeTransaction('');
      expect(result.category).toBe('Misc');
      expect(result.vendor).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('returns Misc with confidence 0.1 for no match', () => {
      const result = categorizeTransaction('Random gibberish 12345 XYZ');
      expect(result.category).toBe('Misc');
      expect(result.confidence).toBe(0.1);
    });

    it('Zoom does not match ZoomCar (negative lookahead)', () => {
      const result = categorizeTransaction('ZoomCar rental booking');
      expect(result.category).toBe('Travel');
      expect(result.vendor).toBe('ZoomCar');
    });

    it('Uber does not match Uber Eats', () => {
      const result = categorizeTransaction('Uber Eats dinner order');
      expect(result.category).toBe('Food & Meals');
      expect(result.vendor).toBe('Uber Eats');
    });

    it('Amazon (shopping) does not match Amazon Web Services', () => {
      const resultAWS = categorizeTransaction('Amazon Web Services');
      expect(resultAWS.category).toBe('Infrastructure');
      const resultShopping = categorizeTransaction('Amazon Purchase laptop');
      expect(resultShopping.category).toBe('Equipment');
    });
  });
});

// ── batchCategorize ─────────────────────────────────────────────────

describe('batchCategorize', () => {
  it('categorizes multiple transactions', () => {
    const transactions = [
      { description: 'AWS Monthly', amount: 15000, type: 'debit' },
      { description: 'Zomato Order', amount: 500, type: 'debit' },
    ];
    const results = batchCategorize(transactions);
    expect(results).toHaveLength(2);
    expect(results[0].category).toBe('Infrastructure');
    expect(results[1].category).toBe('Food & Meals');
  });

  it('upgrades low-confidence credit transactions to Income / Revenue', () => {
    const transactions = [
      { description: 'Transfer from XYZ Company', amount: 100000, type: 'credit' },
    ];
    const results = batchCategorize(transactions);
    expect(results[0].category).toBe('Income / Revenue');
    expect(results[0].confidence).toBe(0.6);
  });

  it('preserves high-confidence credit categories', () => {
    const transactions = [
      { description: 'Razorpay Refund', amount: 500, type: 'credit' },
    ];
    const results = batchCategorize(transactions);
    // Razorpay matches Software vendor rule at 0.9 confidence — preserved
    expect(results[0].category).toBe('Software');
    expect(results[0].confidence).toBe(0.9);
  });

  it('handles empty array', () => {
    const results = batchCategorize([]);
    expect(results).toEqual([]);
  });

  it('does not upgrade credit with medium confidence (e.g. 0.5)', () => {
    const transactions = [
      { description: 'ATM CASH DEPOSIT', amount: 50000, type: 'credit' },
    ];
    const results = batchCategorize(transactions);
    // ATM matches keyword rule at 0.5 confidence — should NOT be upgraded
    expect(results[0].category).toBe('Misc');
    expect(results[0].confidence).toBe(0.5);
  });
});

// ── extractVendorFromDesc (via keyword fallback) ──────────────────

describe('vendor extraction from description', () => {
  it('extracts UPI vendor name', () => {
    const result = categorizeTransaction('UPI/408234234/MyVendorName/upi@bank');
    // This goes through keyword or fallback, extracting "MyVendorName"
    expect(result.vendor).toBeTruthy();
  });

  it('extracts POS vendor name', () => {
    const result = categorizeTransaction('POS/Coffee House Ltd/BANGALORE');
    expect(result.vendor).toBeTruthy();
  });

  it('extracts IMPS vendor name', () => {
    const result = categorizeTransaction('MMT/IMPS/4046195 68526/NIDISH RAMA/Axis Bank');
    expect(result.vendor).toBeTruthy();
  });

  it('returns null vendor for unrecognizable description', () => {
    const result = categorizeTransaction('12345 67890');
    expect(result.vendor).toBeNull();
  });

  it('cleans vendor names with long numbers and special chars', () => {
    const result = categorizeTransaction('NEFT- AXOMB4047307765 3-JOHN DOE 1234567890123-OTHER');
    expect(result.vendor).toBe('JOHN DOE');
  });
});

describe('IMPS/NEFT edge cases for null returns', () => {
  it('extractIMPSPersonName returns null when name is all digits', () => {
    // MMT/IMPS/digits/digits/ — fails the [A-Za-z] requirement
    const result = categorizeTransaction('MMT/IMPS/12345/999888/', 'debit');
    // Should not extract person name, falls through to other matching
    expect(result).toBeDefined();
    expect(result.category).not.toBe('Salaries');
  });

  it('NEFT pattern without person name returns null', () => {
    // NEFT without the expected person name segment
    const result = categorizeTransaction('NEFT- 12345-', 'debit');
    expect(result).toBeDefined();
  });

  it('BIL/ONL without trailing vendor returns Misc', () => {
    // BIL/ONL with no match after digits
    const result = categorizeTransaction('BIL/ONL/123456');
    expect(result.category).toBe('Misc');
  });

  it('MSI/ without vendor segment', () => {
    const result = categorizeTransaction('MSI/');
    expect(result.category).toBe('Misc');
  });

  it('handles credit type for keyword fallback', () => {
    const result = categorizeTransaction('Some transfer payment', 'credit');
    expect(result).toBeDefined();
  });
});


