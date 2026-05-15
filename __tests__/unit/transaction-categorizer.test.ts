import { describe, it, expect } from 'vitest';
import { categorizeTransaction, batchCategorize } from '@/lib/transaction-categorizer';

describe('transaction-categorizer', () => {
  it('categorizes BIL/ONL bills with fallback', () => {
    // Matches the MSI/ pattern
    expect(categorizeTransaction('MSI/AWS/123')).toMatchObject({
      category: 'Infrastructure', vendor: 'AWS', confidence: 0.9
    });
    
    // Unrecognized MSI
    expect(categorizeTransaction('MSI/RandomSaaS/123')).toMatchObject({
      category: 'Software', vendor: 'RandomSaaS', confidence: 0.7
    });

    // BIL/ONL patterns
    expect(categorizeTransaction('BIL/ONL/12345/Jio')).toMatchObject({
      category: 'Telecom & Internet', vendor: 'Jio', confidence: 0.9
    });

    expect(categorizeTransaction('BIL/ONL/12345/Unknown Bill')).toMatchObject({
      category: 'Misc', vendor: 'Unknown Bill', confidence: 0.5
    });
  });

  it('categorizes MSI/ patterns directly', () => {
    // Tests lines 289-302 directly
    expect(categorizeTransaction('MSI/GITHUB.COM')).toMatchObject({
      category: 'Software', vendor: 'GitHub', confidence: 0.9
    });
  });

  it('cleans vendor names from various formats', () => {
    // Tests lines 333-362 directly
    expect(categorizeTransaction('UPI/1234567890/Vendor Name/@ybl')).toMatchObject({
      vendor: 'Vendor Name'
    });

    expect(categorizeTransaction('NEFT- AXOMB123 -PRATEEK-')).toMatchObject({
      vendor: 'PRATEEK'
    });
    
    expect(categorizeTransaction('MMT/IMPS/123 456/IMPS/SOME VENDOR/Bank')).toMatchObject({
      vendor: 'SOME VENDOR'
    });
    
    expect(categorizeTransaction('POS VENDOR NAME/MUMBAI')).toMatchObject({
      vendor: 'VENDOR NAME'
    });
  });
});
