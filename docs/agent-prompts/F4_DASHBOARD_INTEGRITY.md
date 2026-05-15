# Agent F4: Dashboard & Reports Integrity (Wave 2A — Priority 3)

> **Wave 1 Context:** All report APIs return 200 with zeroes.
> Dashboard shape is correct: `monthlyRevenue`, `burnRate`, `runwayMonths`, `outstandingInvoices`.
> Health score returns 65/B even with empty data (reasonable default).
> This agent runs AFTER F2 (import pipeline) so there's real data to verify against.

You are the Dashboard Integrity Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## Pre-Condition
Run this agent AFTER Agent F2 has been run and bank statement CSVs have been imported.
The database should have real BankTransactions, Expenses, and Revenue entries.

## Verified API Response Shapes (from Wave 1)

```json
// /api/dashboard
{
  "monthlyRevenue": 0,
  "totalMonthlyRevenue": 0,
  "burnRate": 0,
  "runwayMonths": null,  // needs handling: null = infinite or N/A
  "outstandingInvoices": { "count": 0, "total": 0 },
  "totalExpensesThisMonth": 0,
  "runway": { "cashInBank": 0, "monthlyBurn": 0, "runwayMonths": null },
  "burnRateDetails": { "currentMonth": 0, "previousMonth": 0, "average3Month": 0, "trend": "stable" },
  "revenueDetails": { "currentMRR": 0, "currentARR": 0, "growth": 0, "history": [] }
}
```

## Tasks

### 1. Verify aggregation after import
Once bank data is imported, check:
- `monthlyRevenue` = sum of Revenue entries this month
- `totalExpensesThisMonth` = sum of Expense entries this month
- `burnRate` = average monthly expenses (trailing 3 months)
- `runwayMonths` = cashInBank / monthlyBurn (handle division by zero → null or Infinity)

### 2. Verify report correctness
- `/api/reports/pnl` — Revenue minus Expenses = Net Income per period
- `/api/reports/cashflow` — Inflows vs Outflows by month
- `/api/reports/aging` — Invoices grouped by age (0-30, 31-60, 61-90, 90+)

### 3. Check Decimal precision
All financial amounts MUST use Prisma Decimal, not JavaScript float.
Grep for `parseFloat` in report routes — these should use `Decimal` or `Number()` with rounding.

### 4. Verify SaaS metrics
`/api/metrics/saas` should calculate:
- MRR from recurring Revenue entries
- Churn from lost clients (if tracked)
- LTV = MRR × avg months

### 5. Check edge cases
- Zero burn rate → runway should be `null` (not Infinity or NaN)
- No revenue history → growth should be `0` (not undefined)
- Single month of data → trend should be "stable" (not enough for trend)

## Files to Audit
- `src/app/api/dashboard/route.ts`
- `src/app/api/reports/pnl/route.ts`
- `src/app/api/reports/cashflow/route.ts`
- `src/app/api/reports/cfo-brief/route.ts`
- `src/app/api/metrics/saas/route.ts`
- `src/app/api/forecast/route.ts`
- `src/lib/runway.ts`
- `src/lib/financial-intelligence.ts`

## Validation
After importing real bank statements:
- Dashboard KPIs show non-zero, correct values
- P&L report has categorized expenses/revenue
- Cash flow chart shows monthly in/out flows
- No NaN, Infinity, or undefined in any response
