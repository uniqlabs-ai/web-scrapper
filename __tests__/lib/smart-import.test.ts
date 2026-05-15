import { describe, it, expect } from 'vitest';
import { classifyPdf, csvSplit, parseDate } from '@/lib/smart-import';

describe('classifyPdf', () => {
  // ── Invoice markers ──
  it('detects "TAX INVOICE"', () => {
    expect(classifyPdf('TAX INVOICE\nINV-001\nTotal: 100000')).toBe('invoice');
  });

  it('detects "SERVICE INVOICE"', () => {
    expect(classifyPdf('SERVICE INVOICE\nDate: 2025-04-01')).toBe('invoice');
  });

  it('detects "PROFORMA INVOICE"', () => {
    expect(classifyPdf('PROFORMA INVOICE for services')).toBe('invoice');
  });

  it('detects INVOICE + AMOUNT combo', () => {
    expect(classifyPdf('Invoice #123\nLine Total\nAmount Due')).toBe('invoice');
  });

  it('detects INVOICE + UNIT PRICE combo', () => {
    expect(classifyPdf('Invoice\nUnit Price\n500')).toBe('invoice');
  });

  // ── Bank statement markers ──
  it('detects "ACCOUNT STATEMENT"', () => {
    expect(classifyPdf('HDFC Bank\nACCOUNT STATEMENT\nPeriod: Apr 2025')).toBe('bank_statement');
  });

  it('detects "TRANSACTION DETAILS"', () => {
    expect(classifyPdf('TRANSACTION DETAILS\nDate\nDescription\nDebit')).toBe('bank_statement');
  });

  it('detects "OPENING BALANCE"', () => {
    expect(classifyPdf('Opening Balance: 100000')).toBe('bank_statement');
  });

  it('detects "CLOSING BALANCE"', () => {
    expect(classifyPdf('Closing Balance: 85000')).toBe('bank_statement');
  });

  it('detects STATEMENT + WITHDRAWAL combo', () => {
    expect(classifyPdf('Monthly Statement\nWithdrawal\nDeposit')).toBe('bank_statement');
  });

  it('detects "VALUE DATE"', () => {
    expect(classifyPdf('Value Date\n01/04/2025')).toBe('bank_statement');
  });

  it('detects "TRANSACTION DATE"', () => {
    expect(classifyPdf('Transaction Date: 01/04/2025')).toBe('bank_statement');
  });

  // ── Financial statement markers ──
  it('detects "BALANCE SHEET"', () => {
    expect(classifyPdf('BALANCE SHEET as at March 31, 2025')).toBe('financial_statement');
  });

  it('detects "PROFIT AND LOSS"', () => {
    expect(classifyPdf('PROFIT AND LOSS ACCOUNT')).toBe('financial_statement');
  });

  it('detects "PROFIT & LOSS"', () => {
    expect(classifyPdf('Profit & Loss Statement')).toBe('financial_statement');
  });

  it('detects "TRIAL BALANCE"', () => {
    expect(classifyPdf('Trial Balance for FY 2024-25')).toBe('financial_statement');
  });

  it('detects "CASH FLOW STATEMENT"', () => {
    expect(classifyPdf('Cash Flow Statement')).toBe('financial_statement');
  });

  it('detects "AUDITOR"', () => {
    expect(classifyPdf('Independent Auditor Report')).toBe('financial_statement');
  });

  it('detects "NOTES TO ACCOUNTS"', () => {
    expect(classifyPdf('Notes to Accounts')).toBe('financial_statement');
  });

  it('detects "ITR"', () => {
    expect(classifyPdf('ITR-3 Assessment Year 2024-25')).toBe('financial_statement');
  });

  it('detects "INCOME TAX RETURN"', () => {
    expect(classifyPdf('Income Tax Return')).toBe('financial_statement');
  });

  it('detects "INCOME AND EXPENDITURE"', () => {
    expect(classifyPdf('Income and Expenditure Account')).toBe('financial_statement');
  });

  it('detects "SCHEDULE"', () => {
    expect(classifyPdf('Schedule of Fixed Assets')).toBe('financial_statement');
  });

  // ── Unknown ──
  it('returns "unknown" for unrecognizable text', () => {
    expect(classifyPdf('Hello World, this is a random document')).toBe('unknown');
  });

  it('returns "unknown" for empty text', () => {
    expect(classifyPdf('')).toBe('unknown');
  });

  // ── Case insensitivity ──
  it('is case-insensitive', () => {
    expect(classifyPdf('tax invoice')).toBe('invoice');
    expect(classifyPdf('account statement')).toBe('bank_statement');
    expect(classifyPdf('balance sheet')).toBe('financial_statement');
  });
});

describe('csvSplit', () => {
  it('splits simple CSV row', () => {
    expect(csvSplit('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with commas', () => {
    expect(csvSplit('"Hello, World",b,c')).toEqual(['Hello, World', 'b', 'c']);
  });

  it('handles empty fields', () => {
    expect(csvSplit('a,,c')).toEqual(['a', '', 'c']);
  });

  it('trims whitespace', () => {
    expect(csvSplit(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('handles single field', () => {
    expect(csvSplit('hello')).toEqual(['hello']);
  });

  it('handles quoted field with embedded quotes', () => {
    expect(csvSplit('"a""b",c')).toEqual(['ab', 'c']);
  });

  it('handles empty string', () => {
    expect(csvSplit('')).toEqual(['']);
  });
});

describe('parseDate', () => {
  it('parses YYYY-MM-DD format', () => {
    const d = parseDate('2025-04-15');
    expect(d.getFullYear()).toBe(2025);
  });

  it('parses DD/MM/YYYY format', () => {
    const d = parseDate('15/04/2025');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(3); // April = 3
  });

  it('parses DD-MM-YYYY format', () => {
    const d = parseDate('15-04-2025');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(3);
  });

  it('parses DD/MMM/YYYY format', () => {
    const d = parseDate('01/Apr/2025');
    expect(d.getFullYear()).toBe(2025);
  });

  it('falls back to Date constructor for unknown formats', () => {
    const d = parseDate('April 15, 2025');
    expect(d.getFullYear()).toBe(2025);
  });

  it('returns current date for empty string', () => {
    const d = parseDate('');
    const now = new Date();
    expect(d.getFullYear()).toBe(now.getFullYear());
  });

  it('returns current date for invalid string', () => {
    const d = parseDate('not-a-date');
    const now = new Date();
    expect(d.getFullYear()).toBe(now.getFullYear());
  });
});
