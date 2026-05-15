import { describe, it, expect } from 'vitest';
import { normalizeTransactions } from '@/lib/bank-import';

describe('lib/bank-import', () => {
  it('hits missing false branches in normalizeTransactions and parseDate', () => {
    const rows = [
      // 1. parseDate year <= 50 (dd/mm/yy)
      { Date: '15/02/49', Amount: '100', Desc: 'Year 49' },
      // 2. parseDate invalid date
      { Date: 'Not-a-date', Amount: '100', Desc: 'Invalid' },
      // 3. mapping.type is missing, but mapping.amount exists, val < 0
      { Date: '2025-01-01', Amount: '-50', Desc: 'Negative' },
      // 4. mapping missing amount, debit, credit completely
      { Date: '2025-01-01', Desc: 'Missing all' }
    ];

    const mapping1 = {
      date: 'Date', description: 'Desc', amount: 'Amount'
    };

    const res1 = normalizeTransactions(rows, mapping1 as any);
    expect(res1[0]?.date.getFullYear()).toBe(2049); // Year 49 -> 2049
    expect(res1[1]?.date.getTime()).not.toBeNaN(); // Falls back to new Date()
    expect(res1[2]?.type).toBe('debit'); // -50 -> debit
    expect(res1[3]).toBeUndefined(); // Missing all -> amount=0 -> skips

    // 5. mapping.debit missing, mapping.credit exists
    const rows2 = [{ Date: '2025-01-01', Desc: 'Credit', Credit: '200' }];
    const mapping2 = { date: 'Date', description: 'Desc', credit: 'Credit' };
    const res2 = normalizeTransactions(rows2, mapping2 as any);
    expect(res2[0]?.type).toBe('credit');

    // 6. mapping.credit missing, mapping.debit exists
    const rows3 = [{ Date: '2025-01-01', Desc: 'Debit', Debit: '100' }];
    const mapping3 = { date: 'Date', description: 'Desc', debit: 'Debit' };
    const res3 = normalizeTransactions(rows3, mapping3 as any);
    expect(res3[0]?.type).toBe('debit');

    // 7. mapping.credit and mapping.debit exist, but both are <= 0
    const rows4 = [{ Date: '2025-01-01', Desc: 'Zero', Debit: '0', Credit: '-5' }];
    const mapping4 = { date: 'Date', description: 'Desc', debit: 'Debit', credit: 'Credit' };
    const res4 = normalizeTransactions(rows4, mapping4 as any);
    expect(res4[0]).toBeUndefined();
  });
});
