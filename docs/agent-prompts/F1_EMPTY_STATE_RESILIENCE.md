# Agent F1: Empty State Resilience (Wave 2A — Priority 2)

> **Wave 1 Context:** All 28 APIs now return 200 with zeroes/empty arrays (tenant fix resolved the 500s).
> Dashboard returns `{ monthlyRevenue: 0, burnRate: 0, runwayMonths: null }`.
> Health returns `{ score: 65, grade: "B" }` even with no data.
> The backend is stable — but the FRONTEND may still render broken UI with null/zero/empty data.

You are the Empty State Resilience Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## Current API Response Shapes (verified live)

```json
// /api/dashboard — returns zeroes, not errors
{ "monthlyRevenue": 0, "burnRate": 0, "runwayMonths": null, "outstandingInvoices": { "count": 0, "total": 0 } }

// /api/invoices — returns empty array
{ "invoices": [] }

// /api/bank/accounts — returns empty array
[]

// /api/health — returns default score
{ "score": 65, "grade": "B" }
```

## Your Tasks

### 1. Audit each page's fetch error handling
Pages use `fetch().then(r => r.json()).then(data => setState(data))`.
Check: does the page handle `data` being empty/zero/null gracefully?

### 2. Add empty state UIs
Use `src/components/empty-state.tsx` (already exists). Each page should show:

| Page | Empty State Message | CTA |
|------|-------------------|-----|
| Dashboard (`/`) | "Welcome! Import a bank statement to see your financial overview" | "Go to Import →" |
| Invoices | "No invoices yet" | "Create Invoice" |
| Expenses | "No expenses recorded" | "Add Expense" or "Import Statement" |
| Revenue | "No revenue tracked yet" | "Import Statement" |
| Bank | "No bank accounts connected" | "Import Bank Statement" |
| Reports | "Not enough data for reports. Import transactions first" | "Go to Import →" |
| Reconciliation | "Nothing to reconcile yet" | "Import Statement" |

### 3. Handle specific null edge cases
- `runwayMonths: null` → display "∞" or "N/A", not "null"
- `revenueGrowth: 0` → display "0%" not blank
- Empty chart data → show placeholder chart with "No data" message
- `history: []` → import history shows "No imports yet" (already done ✅)

### 4. Priority order (by user impact)
1. `src/app/page.tsx` (369 LOC) — Dashboard, first thing users see
2. `src/app/bank/page.tsx` (1473 LOC) — bank page user was looking at
3. `src/app/invoices/page.tsx` (905 LOC) — core feature
4. `src/app/expenses/page.tsx` (1138 LOC) — core feature
5. `src/app/reports/page.tsx` (774 LOC) — key differentiator
6. `src/app/saas-metrics/page.tsx` — unique feature, must look good empty
7. Rest of pages

### 5. Do NOT break existing pages
- `src/app/health/page.tsx` — already fixed ✅ (null safety added in Wave 1)
- `src/app/import/page.tsx` — already works ✅

## Validation
- Navigate to http://localhost:3008 with empty database
- Visit EVERY page from the sidebar
- ZERO console errors
- Every page shows a meaningful empty state, not blank content or "0" everywhere
- No "undefined" or "null" visible in the UI
