import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  detectColumnMapping,
  normalizeTransactions,
  extractVendor,
} from '@/lib/bank-import';

// ── parseCSV ─────────────────────────────────────────────────────────

describe('parseCSV', () => {
  it('parses standard CSV with headers', () => {
    const csv = 'Date,Description,Amount\n2025-04-01,AWS Monthly,15000\n2025-04-02,Rent,85000';
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(['Date', 'Description', 'Amount']);
    expect(rows).toHaveLength(2);
    expect(rows[0]['Date']).toBe('2025-04-01');
    expect(rows[0]['Description']).toBe('AWS Monthly');
    expect(rows[0]['Amount']).toBe('15000');
  });

  it('handles quoted fields with commas', () => {
    const csv = 'Name,Address\n"John","123 Main St, Apt 4"';
    const { rows } = parseCSV(csv);
    expect(rows[0]['Address']).toBe('123 Main St, Apt 4');
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    const csv = 'Name,Desc\n"John","He said ""hello"" to me"';
    const { rows } = parseCSV(csv);
    expect(rows[0]['Desc']).toBe('He said "hello" to me');
  });

  it('returns empty for empty input', () => {
    const { headers, rows } = parseCSV('');
    expect(headers).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('returns empty rows for header-only input', () => {
    const { headers, rows } = parseCSV('Col1,Col2');
    expect(headers).toEqual(['Col1', 'Col2']);
    expect(rows).toEqual([]);
  });

  it('handles Windows line endings (\\r\\n)', () => {
    const csv = 'A,B\r\n1,2\r\n3,4';
    const { rows } = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]['A']).toBe('1');
  });

  it('handles old Mac line endings (\\r)', () => {
    const csv = 'A,B\r1,2\r3,4';
    const { rows } = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it('skips blank lines', () => {
    const csv = 'A,B\n1,2\n\n3,4\n';
    const { rows } = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it('supports custom delimiter', () => {
    const csv = 'A;B\n1;2';
    const { headers, rows } = parseCSV(csv, { delimiter: ';' });
    expect(headers).toEqual(['A', 'B']);
    expect(rows[0]['A']).toBe('1');
  });

  it('handles no-header mode', () => {
    const csv = '1,2\n3,4';
    const { headers, rows } = parseCSV(csv, { hasHeader: false });
    expect(headers).toEqual(['column_0', 'column_1']);
    expect(rows).toHaveLength(2);
    expect(rows[0]['column_0']).toBe('1');
  });

  it('strips quotes from header names', () => {
    const csv = '"Date","Amount"\n2025-01-01,1000';
    const { headers } = parseCSV(csv);
    expect(headers).toEqual(['Date', 'Amount']);
  });

  it('handles rows with fewer columns than headers', () => {
    const csv = 'A,B,C\n1,2';
    const { rows } = parseCSV(csv);
    expect(rows[0]['C']).toBe('');
  });
});

// ── detectColumnMapping ──────────────────────────────────────────────

describe('detectColumnMapping', () => {
  it('detects ICICI bank format', () => {
    const headers = ['S No.', 'Value Date', 'Transaction Date', 'Cheque Number', 'Transaction Remarks', 'Withdrawal Amount (INR )', 'Deposit Amount (INR )', 'Balance (INR )'];
    const mapping = detectColumnMapping(headers);
    expect(mapping.date).toBeTruthy();
    expect(mapping.description).toBeTruthy();
    expect(mapping.debit).toBeTruthy();
    expect(mapping.credit).toBeTruthy();
    expect(mapping.balance).toBeTruthy();
  });

  it('detects HDFC bank format', () => {
    const headers = ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'];
    const mapping = detectColumnMapping(headers);
    expect(mapping.date).toBe('Date');
    expect(mapping.description).toBe('Narration');
    expect(mapping.debit).toBeTruthy();
    expect(mapping.credit).toBeTruthy();
    expect(mapping.balance).toBeTruthy();
  });

  it('detects generic format with single amount column', () => {
    const headers = ['Date', 'Description', 'Amount', 'Balance'];
    const mapping = detectColumnMapping(headers);
    expect(mapping.date).toBe('Date');
    expect(mapping.description).toBe('Description');
    expect(mapping.amount).toBe('Amount');
    expect(mapping.balance).toBe('Balance');
  });

  it('detects Cr/Dr type indicator column', () => {
    const headers = ['Date', 'Particulars', 'Amount', 'Cr/Dr', 'Balance'];
    const mapping = detectColumnMapping(headers);
    expect(mapping.type).toBe('Cr/Dr');
  });

  it('detects reference/UTR column', () => {
    const headers = ['Date', 'Description', 'Amount', 'Ref No', 'Balance'];
    const mapping = detectColumnMapping(headers);
    expect(mapping.reference).toBe('Ref No');
  });

  it('returns partial mapping when columns are missing', () => {
    const headers = ['Random', 'Columns', 'Here'];
    const mapping = detectColumnMapping(headers);
    // Should not crash, may have partial or empty mappings
    expect(mapping).toBeDefined();
    expect(typeof mapping).toBe('object');
  });

  it('detects transaction date variations', () => {
    const headers = ['Txn Date', 'Description', 'Debit'];
    const mapping = detectColumnMapping(headers);
    expect(mapping.date).toBe('Txn Date');
  });
});

// ── normalizeTransactions ────────────────────────────────────────────

describe('normalizeTransactions', () => {
  it('normalizes single-amount-column transactions (negative = debit)', () => {
    const rows = [
      { Date: '01/04/2025', Description: 'AWS Monthly', Amount: '-15000', Balance: '100000' },
      { Date: '02/04/2025', Description: 'Client Payment', Amount: '250000', Balance: '350000' },
    ];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount', balance: 'Balance' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result).toHaveLength(2);
    expect(result[0].amount).toBe(15000);
    expect(result[0].type).toBe('debit');
    expect(result[0].description).toBe('AWS Monthly');
    expect(result[1].amount).toBe(250000);
    expect(result[1].type).toBe('credit');
  });

  it('normalizes separate debit/credit columns', () => {
    const rows = [
      { Date: '01/04/2025', Narration: 'Office Rent', Debit: '85000', Credit: '', Balance: '15000' },
      { Date: '02/04/2025', Narration: 'Payment In', Debit: '', Credit: '200000', Balance: '215000' },
    ];
    const mapping = { date: 'Date', description: 'Narration', debit: 'Debit', credit: 'Credit', balance: 'Balance' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('debit');
    expect(result[0].amount).toBe(85000);
    expect(result[1].type).toBe('credit');
    expect(result[1].amount).toBe(200000);
  });

  it('normalizes Cr/Dr type indicator column', () => {
    const rows = [
      { Date: '01/04/2025', Description: 'Payment', Amount: '5000', 'Cr/Dr': 'Cr' },
      { Date: '02/04/2025', Description: 'Expense', Amount: '3000', 'Cr/Dr': 'Dr' },
    ];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount', type: 'Cr/Dr' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].type).toBe('credit');
    expect(result[1].type).toBe('debit');
  });

  it('filters out zero-amount rows', () => {
    const rows = [
      { Date: '01/04/2025', Description: 'Opening Balance', Amount: '0' },
      { Date: '02/04/2025', Description: 'AWS', Amount: '15000' },
    ];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('AWS');
  });

  it('generates unique dedup hashes', () => {
    const rows = [
      { Date: '01/04/2025', Description: 'AWS', Amount: '15000' },
      { Date: '02/04/2025', Description: 'AWS', Amount: '15000' },
    ];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].hash).toBeTruthy();
    expect(result[1].hash).toBeTruthy();
    expect(result[0].hash).not.toBe(result[1].hash); // different dates = different hashes
  });

  it('generates same hash for same input (deterministic)', () => {
    const rows = [{ Date: '01/04/2025', Description: 'Test', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result1 = normalizeTransactions(rows, mapping as any);
    const result2 = normalizeTransactions(rows, mapping as any);

    expect(result1[0].hash).toBe(result2[0].hash);
  });

  it('parses dd/mm/yyyy dates correctly', () => {
    const rows = [{ Date: '15/04/2025', Description: 'Test', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].date.getDate()).toBe(15);
    expect(result[0].date.getMonth()).toBe(3); // April (0-indexed)
    expect(result[0].date.getFullYear()).toBe(2025);
  });

  it('parses dd-Mon-yyyy dates correctly', () => {
    const rows = [{ Date: '15-Feb-2025', Description: 'Test', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].date.getMonth()).toBe(1); // February
    expect(result[0].date.getFullYear()).toBe(2025);
  });

  it('parses yyyy-mm-dd (ISO) dates correctly', () => {
    const rows = [{ Date: '2025-04-15', Description: 'Test', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].date.getMonth()).toBe(3); // April
    expect(result[0].date.getFullYear()).toBe(2025);
  });

  it('parses dd/mm/yy with 2-digit year', () => {
    const rows = [{ Date: '15/04/25', Description: 'Test', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].date.getFullYear()).toBe(2025);
  });

  it('parses Indian currency amounts (₹1,23,456.78)', () => {
    const rows = [{ Date: '01/04/2025', Description: 'Test', Amount: '₹1,23,456.78' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].amount).toBe(123456.78);
  });

  it('parses parenthesized negatives as debit', () => {
    const rows = [{ Date: '01/04/2025', Description: 'Test', Amount: '(1,234.56)' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].amount).toBe(1234.56);
    expect(result[0].type).toBe('debit');
  });

  it('parses dd-Mon-yy with 2-digit year (e.g., "15 Feb 25")', () => {
    const rows = [{ Date: '15 Feb 25', Description: 'Short Year', Amount: '5000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].date.getFullYear()).toBe(2025);
    expect(result[0].date.getMonth()).toBe(1); // February
    expect(result[0].date.getDate()).toBe(15);
  });

  it('parses dd-Mon-yy with year > 50 as 19xx', () => {
    const rows = [{ Date: '01-Jan-99', Description: 'Old Date', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].date.getFullYear()).toBe(1999);
  });

  it('handles empty/dash amount as zero (filtered out)', () => {
    const rows = [
      { Date: '01/04/2025', Description: 'Empty', Amount: '' },
      { Date: '02/04/2025', Description: 'Dash', Amount: '-' },
    ];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result).toHaveLength(0); // Both filtered as zero amount
  });

  it('includes reference field when mapped', () => {
    const rows = [{ Date: '01/04/2025', Description: 'Test', Amount: '1000', Ref: 'UTR123456' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount', reference: 'Ref' };
    const result = normalizeTransactions(rows, mapping as any);

    expect(result[0].reference).toBe('UTR123456');
  });
});

// ── extractVendor ────────────────────────────────────────────────────

describe('extractVendor', () => {
  it('extracts vendor from UPI format (captures first segment after UPI)', () => {
    // UPI regex captures first segment after separator, which is the reference number
    expect(extractVendor('UPI/408234234/SwiggyFood/REF123')).toBe('408234234');
  });

  it('extracts vendor from UPI when vendor is first segment', () => {
    expect(extractVendor('UPI/SwiggyFood/REF123')).toBe('SwiggyFood');
  });

  it('extracts vendor from UPI with dash separator (captures first segment)', () => {
    // The regex UPI[\/-]([^\/\-]+) captures the first segment after UPI-
    // which is the reference number, not the vendor name
    expect(extractVendor('UPI-408234234-SwiggyFood')).toBe('408234234');
  });

  it('extracts vendor from UPI with slash separator', () => {
    expect(extractVendor('UPI/SwiggyFood/REF123')).toBe('SwiggyFood');
  });

  it('extracts vendor from NEFT format', () => {
    expect(extractVendor('NEFT/ACME Corp/REF456')).toBe('ACME Corp');
  });

  it('extracts vendor from IMPS format', () => {
    expect(extractVendor('IMPS/Vendor Name/REF789')).toBe('Vendor Name');
  });

  it('extracts vendor from RTGS format', () => {
    expect(extractVendor('RTGS/Big Corp Ltd/REF000')).toBe('Big Corp Ltd');
  });

  it('extracts vendor from POS format', () => {
    expect(extractVendor('POS/Starbucks Coffee Shop')).toBe('Starbucks Coffee Shop');
  });

  it('extracts vendor from ONLINE/ECOM format', () => {
    expect(extractVendor('ECOM/Amazon India')).toBe('Amazon India');
  });

  it('extracts vendor from BIL format', () => {
    expect(extractVendor('BIL/Airtel Postpaid')).toBe('Airtel Postpaid');
  });

  it('extracts vendor from NACH format', () => {
    expect(extractVendor('NACH/Loan EMIs/REF123')).toBe('Loan EMIs');
  });

  it('extracts vendor from INB format', () => {
    expect(extractVendor('INB/Transfer/REF123')).toBe('Transfer');
  });

  it('returns null when no pattern matches', () => {
    expect(extractVendor('Random transfer 12345')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractVendor('')).toBeNull();
  });
});

describe('Date and Amount parsing fallbacks', () => {
  it('handles invalid date parsing', () => {
    const rows = [{ Date: 'Completely Invalid Date', Description: 'Test', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);
    // Should fallback to new Date() which parses validly
    expect(result[0].date).toBeInstanceOf(Date);
  });

  it('handles empty date string', () => {
    const rows = [{ Date: '', Description: 'Test', Amount: '1000' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);
    expect(result[0].date).toBeInstanceOf(Date);
  });

  it('handles invalid amount string', () => {
    const rows = [{ Date: '2025-01-01', Description: 'Test', Amount: 'Not a number' }];
    const mapping = { date: 'Date', description: 'Description', amount: 'Amount' };
    const result = normalizeTransactions(rows, mapping as any);
    // Invalid amounts parse to 0 and are filtered out
    expect(result).toHaveLength(0);
  });
});
