import { describe, it, expect } from 'vitest';
import { parseBankEmail, isBankAlert } from '@/lib/gmail-parser';

describe('parseBankEmail', () => {
  it('parses debit notification (INR format)', () => {
    const result = parseBankEmail(
      'Transaction Alert',
      'INR 15,000 has been debited from your A/C XX1234. Avl Bal: INR 85,000. Info: AMAZON PAY INDIA on UPI Ref 123456',
      'alerts@icicibank.com',
      new Date('2025-04-15')
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(15000);
    expect(result!.type).toBe('debit');
    expect(result!.accountLast4).toBe('1234');
    expect(result!.balance).toBe(85000);
    expect(result!.bank).toBe('ICICI');
  });

  it('parses credit notification (Rs format)', () => {
    const result = parseBankEmail(
      'Credit Alert',
      'Rs. 50,000 has been credited to your a/c ending 5678. Available balance is Rs. 1,50,000.',
      'alerts@hdfcbank.com',
      new Date('2025-04-15')
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(50000);
    expect(result!.type).toBe('credit');
    expect(result!.bank).toBe('HDFC');
  });

  it('parses debit with ₹ symbol', () => {
    const result = parseBankEmail(
      'Debit Alert',
      'Your a/c XXXX4321 debited by ₹ 2,500 for purchase at SWIGGY on UPI',
      'noreply@axisbank.com',
      new Date()
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(2500);
    expect(result!.type).toBe('debit');
    expect(result!.bank).toBe('Axis');
  });

  it('returns null when no amount found', () => {
    const result = parseBankEmail(
      'Welcome to banking',
      'Thank you for choosing our bank. Please complete your KYC.',
      'support@somebank.com',
      new Date()
    );
    expect(result).toBeNull();
  });

  it('extracts reference number', () => {
    const result = parseBankEmail(
      'UPI Transaction',
      'INR 1,000 debited from A/C XX9999. Ref No: TXN789012',
      'alerts@sbi.co.in',
      new Date()
    );
    expect(result).not.toBeNull();
    expect(result!.reference).toBe('TXN789012');
    expect(result!.bank).toBe('SBI');
  });

  it('handles credit with "received" keyword', () => {
    const result = parseBankEmail(
      'Amount Received',
      'INR 25,000 received in your account ending 8888. Available balance: INR 1,25,000.',
      'alerts@kotak.com',
      new Date()
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe('credit');
    expect(result!.amount).toBe(25000);
    expect(result!.bank).toBe('Kotak');
  });

  it('maps various Indian banks correctly', () => {
    const banks = [
      ['alerts@yesbank.com', 'Yes Bank'],
      ['noreply@indusind.com', 'IndusInd'],
      ['alerts@rblbank.com', 'RBL'],
      ['alerts@federalbank.com', 'Federal'],
      ['alerts@idfcfirst.com', 'IDFC First'],
      ['alerts@bankofbaroda.com', 'Bank of Baroda'],
      ['alerts@pnb.co.in', 'PNB'],
      ['alerts@canarabank.com', 'Canara'],
    ];
    for (const [sender, expected] of banks) {
      const result = parseBankEmail('Alert', 'INR 100 debited from A/C XX0000', sender, new Date());
      expect(result?.bank).toBe(expected);
    }
  });
});

describe('isBankAlert', () => {
  it('returns true for bank transaction subject + bank sender', () => {
    expect(isBankAlert('Transaction Alert - Debit', 'alerts@icicibank.com')).toBe(true);
  });

  it('returns false for non-bank subject', () => {
    expect(isBankAlert('Your order is shipped', 'alerts@amazon.com')).toBe(false);
  });

  it('matches user-registered bank domains', () => {
    expect(isBankAlert('Credit Alert', 'txn@custombank.in', ['custombank.in'])).toBe(true);
  });

  it('returns false for bank subject but non-bank sender', () => {
    expect(isBankAlert('UPI Transaction', 'newsletter@spamsite.com')).toBe(false);
  });

  it('detects various transaction keywords', () => {
    const keywords = ['debit', 'credit', 'UPI', 'NEFT', 'purchase', 'refund', 'EMI'];
    for (const kw of keywords) {
      expect(isBankAlert(`${kw} Alert`, 'alerts@bank.com')).toBe(true);
    }
  });
});
