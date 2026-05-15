# Agent F2: Import Pipeline Hardening (Wave 2A — Priority 1)

> **Wave 1 Context:** User uploaded 3 DetailedStatement PDF files — ALL FAILED with 500s.
> Root cause was tenant auto-creation (now fixed). But the import pipeline itself needs hardening.

You are the Import Pipeline Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## Current State (Post Wave 1)
- Tenant auto-creation: ✅ FIXED in `src/lib/tenant.ts`
- CSV parsing in smart import: ✅ FIXED — `parseCSV` + `detectColumnMapping` integrated
- All APIs return 200: ✅ VERIFIED
- Bank accounts in DB: **0** (fresh state)
- Import batches: **0** (fresh state)

## What Still Needs Fixing

### Issue 1: PDF Import Path
The Smart Import PDF path uses Python scripts (`scripts/extract_pdf_statement.py`).
- Check if the Python script exists and is executable
- Verify it handles ICICI/HDFC/Axis DetailedStatement PDF formats
- If Python extraction fails, the route should fall back to a clear error message, not a generic 500

**Files:** `src/app/api/import/smart/route.ts` (lines ~50-80, PDF handling)

### Issue 2: Duplicate Bank Accounts
The CSV and PDF import paths create bank accounts independently:
- CSV path (smart import): creates "Primary Account" or matches by `bankName`
- PDF path: creates "ICICI Bank - XXXX" from extracted metadata
- Result: same bank's statements create 2 different accounts

**Fix:** Create a shared helper in `src/lib/bank-import.ts`:
```ts
export async function findOrCreateBankAccount(
  prisma: any,
  organizationId: string,
  bankName?: string,
  accountNumber?: string
): Promise<string>  // returns bankAccountId
```
Logic: Match by accountNumber first → bankName second → create new only if no match.

Both `src/app/api/import/smart/route.ts` and `src/app/api/bank/import/route.ts` should use this helper.

### Issue 3: Transaction Dedup
The `/api/bank/import` route has hash-based dedup, but the smart import CSV path (added in Wave 1) does not.
- Before creating each `BankTransaction`, check if hash exists for this org
- Track skip count and report in response: `{ imported: N, skipped: M }`

### Issue 4: Import Progress
Large CSV files (500+ rows) take time. Currently no progress indication.
- At minimum, return the total count in the response
- Consider chunked response for real-time progress (stretch goal)

## Test Files Available
- `/Users/nidishramakrishnan/Work/founderOS/finance/DetailedStatement_FY24.csv`
- `/Users/nidishramakrishnan/Work/founderOS/finance/DetailedStatement_FY25.csv`
- `/Users/nidishramakrishnan/Work/founderOS/finance/DetailedStatement_FY26.csv`
- CSV format: `Date,Description,Withdrawal (Dr),Deposit (Cr),Balance,Type,Reference`

## Validation Criteria
1. Upload `DetailedStatement_FY25.csv` → imports N transactions, creates 1 bank account
2. Upload same file again → 0 imported, N skipped (dedup works)
3. Upload `DetailedStatement_FY24.csv` → imports to SAME bank account (not a new one)
4. Check `/api/bank/accounts` → exactly 1 bank account exists
5. Check Dashboard → shows non-zero revenue/expenses from imported data
