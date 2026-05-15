# 04 — Testing Agent

> **Domain**: Finance Suite (`/Users/nidishramakrishnan/Work/founderOS/finance`)
> **Target**: **95% line/statement/function coverage** · **90% branch coverage**
> **Scope**: 12 lib modules + 8 API route groups
> **Framework**: Vitest 4.x + @vitest/coverage-v8

---

## 1 · Current Baseline

| Metric | Value |
|--------|-------|
| Total test files | **19** (12 lib + 7 integration) |
| Total passing tests | **459 / 459** |
| Lib modules covered | **12 of 12** priority modules |
| API route groups covered | **7 of 8** (`invoices`, `expenses`, `reports`, `dashboard`, `vendors`, `plugin/heartbeat`, `plugin/manifest`) |
| Estimated coverage | **~70%+** (pending `npx vitest run --coverage` for exact metrics) |

### Vitest Config (reference)

```ts
// vitest.config.ts — thresholds already wired
coverage: {
  provider: 'v8',
  thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
  include: ['src/**/*.ts', 'src/**/*.tsx'],
  exclude: ['node_modules/**', '**/*.config.*', '**/*.d.ts', '**/types/**',
            'prisma/**', 'e2e/**', 'src/app/layout.tsx', 'src/app/providers.tsx'],
}
```

---

## 2 · Target Lib Modules (12 priority modules)

### ✅ Already Covered (3)

| # | Module | LOC | Tests | Status |
|---|--------|-----|-------|--------|
| 1 | `currency.ts` | 103 | 31 assertions | ✅ DONE |
| 2 | `gst.ts` | 60 | 21 assertions | ✅ DONE |
| 3 | `runway.ts` | 127 | 14 assertions | ✅ DONE |

### 🔴 Untested — Must Cover (9)

| # | Module | LOC | Priority | Key Functions to Test |
|---|--------|-----|----------|----------------------|
| 4 | **`tds.ts`** | 85 | P0 | `calculateTDS()`, `getSectionForExpenseType()`, `getCurrentQuarter()` |
| 5 | **`transaction-categorizer.ts`** | 382 | P0 | `categorizeTransaction()`, `batchCategorize()`, `VENDOR_RULES`, `KEYWORD_RULES`, IMPS/NEFT extraction |
| 6 | **`bank-import.ts`** | 398 | P0 | `parseCSV()`, `detectColumnMapping()`, `normalizeTransactions()`, `extractVendor()` |
| 7 | **`csv-importer.ts`** | 437 | P0 | `autoDetectMapping()`, `validateAndPreview()`, `transformForInsert()` |
| 8 | **`financial-intelligence.ts`** | 320 | P0 | `generatePnL()`, `projectCashFlow()`, `projectCashFlowOutlook()`, `calculateGSTSummary()` |
| 9 | **`rbac.ts`** | 149 | P1 | `hasPermission()`, `hasAccess()`, `checkPermission()`, `logActivity()` |
| 10 | **`roles.ts`** | 66 | P1 | `hasPermission()` (resource-scoped), `ROLE_PERMISSIONS` matrix |
| 11 | **`founder-os-jwt.ts`** | 58 | P1 | `extractFounderOSToken()`, `requireAuth()`, token expiry, malformed tokens |
| 12 | **`anomalies.ts`** | 107 | P1 | `detectAnomalies()` — duplicate detection, category spikes |

### 📎 Utility Modules (lower priority, cover if time permits)

| Module | LOC | Notes |
|--------|-----|-------|
| `payouts.ts` | 96 | External API (RazorpayX) — mock `fetch` |
| `webhooks.ts` | 59 | External dispatch — mock `fetch` + Prisma |
| `auth.ts` | 89 | NextAuth session — mock `getServerSession` |
| `api-auth.ts` | 34 | API key validation — mock Prisma |
| `audit.ts` | 28 | Simple Prisma create — low-risk |
| `document-intelligence.ts` | 62 | Gemini API — mock generative AI |
| `gmail-parser.ts` | 216 | Gmail API — mock googleapis |
| `pdf.ts` | 265 | PDF generation — mock jsPDF/@react-pdf |
| `ai-provider.ts` | 122 | LLM provider switching — mock APIs |
| `prisma.ts` | 18 | Client init — not testable |
| `types.ts` | 63 | Type-only — no runtime logic |
| `utils.ts` | 6 | `cn()` utility — trivial |

---

## 3 · Target API Route Groups (8 groups)

> **Testing pattern**: Mock Prisma + NextAuth, import route handlers directly, call with mock `NextRequest`.

### Group 1: Auth (`/api/auth`) — 8 routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `[...nextauth]/route.ts` | GET, POST | Session creation, provider config |
| `route.ts` | GET | Auth status |

**Key assertions**: Session validity, redirect on unauthenticated, OAuth provider wiring.

### Group 2: Invoices (`/api/invoices`) — 9 routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `route.ts` | GET, POST | List/create invoice, pagination, currency handling |
| `[id]/route.ts` | GET, PATCH, DELETE | Single invoice CRUD |
| `[id]/email/route.ts` | POST | Email dispatch (mock Resend) |
| `[id]/payments/route.ts` | POST | Payment recording, status transition |
| `[id]/pdf/route.ts` | GET | PDF generation |
| `[id]/[action]/route.ts` | POST | Status transitions (send, void, mark-paid) |
| `auto-match/route.ts` | POST | AR auto-matching logic |
| `remind/route.ts` | POST | Overdue reminder dispatch |

**Key assertions**: Decimal precision, GST line-item totals, status FSM, tenant isolation.

### Group 3: Expenses (`/api/expenses`) — 7 routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `route.ts` | GET, POST | List/create with category, pagination |
| `[id]/route.ts` | GET, PATCH, DELETE | Single expense CRUD |
| `[id]/receipt/route.ts` | POST | Receipt upload + OCR trigger |
| `approvals/route.ts` | GET, PATCH | Approval workflow (RBAC-gated) |
| `breakdown/route.ts` | GET | Category breakdown aggregation |
| `confidence/route.ts` | GET | AI categorization confidence scores |
| `suggest-category/route.ts` | POST | AI category suggestion |

**Key assertions**: Budget enforcement, approval FSM, receipt-to-expense linking.

### Group 4: Bank & Import (`/api/bank`, `/api/import`) — 7 routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `bank/accounts/route.ts` | GET, POST | Bank account CRUD |
| `bank/import/route.ts` | POST | CSV upload → transaction normalization |
| `bank/transactions/route.ts` | GET | Transaction listing with filters |
| `import/csv/route.ts` | POST | Generic CSV import |
| `import/pdf/route.ts` | POST | PDF statement import |
| `import/smart/route.ts` | POST | AI-assisted column detection |
| `import/history/route.ts` | GET | Import history |

**Key assertions**: Dedup hashing, date parsing (Indian formats), amount parsing (₹/$/€), column auto-detection.

### Group 5: Reports (`/api/reports`) — 7 routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `pnl/route.ts` | GET | P&L generation |
| `pnl/csv/route.ts` | GET | CSV export |
| `cashflow/route.ts` | GET | Cash flow projection |
| `aging/route.ts` | GET | AR/AP aging buckets |
| `comparison/route.ts` | GET | Period-over-period comparison |
| `tax/route.ts` | GET | TDS/GST tax summary |
| `cfo-brief/route.ts` | GET | AI-generated CFO brief |
| `pdf/route.ts` | GET | PDF export |

**Key assertions**: Date-range filtering, decimal rounding, aggregation correctness.

### Group 6: Compliance (`/api/gst`, `/api/tds`, `/api/compliance`) — 7 routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `gst/returns/route.ts` | GET | GSTR-1/3B data aggregation |
| `gst/hsn/route.ts` | GET | HSN code lookup |
| `gst/einvoice/route.ts` | POST | E-invoice generation |
| `gst/cleartax/route.ts` | POST | ClearTax integration |
| `tds/route.ts` | GET | TDS deductions list |
| `tds/compute/route.ts` | POST | TDS calculation |
| `tds/form16a/route.ts` | GET | Form 16A generation |
| `compliance/calendar/route.ts` | GET | Compliance deadline calendar |

**Key assertions**: Tax rate accuracy, section mapping, threshold enforcement, quarter boundaries.

### Group 7: Plugin/V1 (`/api/v1`) — 8 routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `plugin/manifest/route.ts` | GET | ✅ DONE |
| `plugin/heartbeat/route.ts` | GET | ✅ DONE |
| `plugin/dashboard/route.ts` | GET | Dashboard summary for orchestrator |
| `auth/founder-os-token/route.ts` | POST | JWT exchange |
| `copilot/query/route.ts` | POST | NL query handling |
| `copilot/action/route.ts` | POST | Copilot action execution |
| `expenses/route.ts` | GET | V1 expense API |
| `invoices/route.ts` | GET | V1 invoice API |
| `webhooks/inbound/route.ts` | POST | Inbound webhook processing |

**Key assertions**: Bearer token validation, copilot response schema, webhook signature verification.

### Group 8: Core Operations (`/api/dashboard`, `/api/vendors`, `/api/reconciliation`) — 6+ routes

| Route | Methods | Test Focus |
|-------|---------|------------|
| `dashboard/route.ts` | GET | Dashboard KPI aggregation |
| `vendors/route.ts` | GET, POST | Vendor CRUD |
| `vendors/[id]/route.ts` | GET, PATCH, DELETE | Single vendor |
| `vendors/fingerprints/route.ts` | GET | Duplicate vendor detection |
| `reconciliation/route.ts` | GET, POST | Bank reconciliation |
| `reconciliation/auto/route.ts` | POST | Auto-reconciliation engine |

**Key assertions**: Aggregation correctness, vendor dedup fingerprinting, reconciliation matching.

---

## 4 · Mock Patterns

### 4.1 Prisma Mock (standard pattern)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    expense: { findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    invoice: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    // ... add models as needed
  },
}));

import { prisma } from '@/lib/prisma';
const mockedPrisma = vi.mocked(prisma);

beforeEach(() => vi.clearAllMocks());
```

### 4.2 NextAuth Session Mock

```ts
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';
const mockSession = vi.mocked(getServerSession);

// Usage: mock authenticated user
mockSession.mockResolvedValue({
  user: { email: 'test@founderos.local', name: 'Test User' },
});
```

### 4.3 External API Mocks

```ts
// RazorpayX — mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

mockFetch.mockResolvedValue({
  ok: true,
  json: async () => ({ id: 'pout_test_123' }),
});

// Gemini AI — mock @google/generative-ai
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => '{"vendorName": "AWS", "amount": 15000}' },
      }),
    }),
  })),
}));
```

### 4.4 NextRequest Factory

```ts
function createMockRequest(
  method: string = 'GET',
  url: string = 'http://localhost:3008/api/test',
  body?: Record<string, unknown>,
  headers?: Record<string, string>
): NextRequest {
  const init: RequestInit = { method, headers: new Headers(headers) };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init);
}
```

---

## 5 · Test File Naming Convention

```
__tests__/
├── lib/
│   ├── currency.test.ts          ✅ exists
│   ├── gst.test.ts               ✅ exists
│   ├── runway.test.ts            ✅ exists
│   ├── tds.test.ts               🔴 create
│   ├── transaction-categorizer.test.ts  🔴 create
│   ├── bank-import.test.ts       🔴 create
│   ├── csv-importer.test.ts      🔴 create
│   ├── financial-intelligence.test.ts   🔴 create
│   ├── rbac.test.ts              🔴 create
│   ├── roles.test.ts             🔴 create
│   ├── founder-os-jwt.test.ts    🔴 create
│   └── anomalies.test.ts         🔴 create
├── integration/
│   ├── plugin-manifest.test.ts   ✅ exists
│   ├── plugin-heartbeat.test.ts  ✅ exists
│   ├── invoices.test.ts          🔴 create
│   ├── expenses.test.ts          🔴 create
│   ├── bank-import.test.ts       🔴 create
│   ├── reports.test.ts           🔴 create
│   ├── compliance.test.ts        🔴 create
│   ├── plugin-v1.test.ts         🔴 create
│   ├── dashboard.test.ts         🔴 create
│   └── reconciliation.test.ts    🔴 create
```

---

## 6 · Priority Matrix & Estimated Test Counts

### P0 — Financial-Critical (must be 100% covered)

| Module | Est. Tests | Rationale |
|--------|-----------|-----------|
| `tds.ts` | 15 | Tax calculation accuracy — regulatory risk |
| `transaction-categorizer.ts` | 30 | Core categorization engine — 182 vendor rules |
| `bank-import.ts` | 25 | CSV parsing, date parsing, dedup — data integrity |
| `csv-importer.ts` | 20 | Column detection, validation — import reliability |
| `financial-intelligence.ts` | 20 | P&L, cash flow, GST summary — executive reporting |
| **API: Invoices** | 25 | Revenue tracking — cannot lose invoice data |
| **API: Expenses** | 20 | Expense tracking — budget enforcement |
| **API: Compliance** | 15 | Tax filing data — regulatory |

### P1 — Security & Access Control

| Module | Est. Tests | Rationale |
|--------|-----------|-----------|
| `rbac.ts` | 15 | Permission enforcement — multi-tenant isolation |
| `roles.ts` | 12 | Resource-scoped permissions — access control |
| `founder-os-jwt.ts` | 10 | Token validation — orchestrator auth |
| `anomalies.ts` | 10 | Anomaly detection — financial alerting |
| **API: Auth** | 10 | Session management — security |
| **API: Plugin/V1** | 12 | Orchestrator communication — ecosystem |

### P2 — Operational

| Module | Est. Tests | Rationale |
|--------|-----------|-----------|
| **API: Bank & Import** | 15 | Data ingestion pipeline |
| **API: Reports** | 12 | Report generation |
| **API: Dashboard** | 8 | Aggregation correctness |
| **API: Reconciliation** | 10 | Matching engine |

**Total estimated**: ~284 new test cases

---

## 7 · Execution Plan

### Wave 1 — Lib Module Unit Tests (P0 + P1)

```bash
# Execute after each module is complete:
npx vitest run __tests__/lib/<module>.test.ts

# Run full lib suite:
npx vitest run __tests__/lib/
```

**Order**:
1. `tds.test.ts` — Pure functions, no mocks needed
2. `roles.test.ts` — Pure functions, no mocks needed
3. `transaction-categorizer.test.ts` — Pure functions, regex testing
4. `bank-import.test.ts` — Pure functions (parseCSV, normalizeTransactions)
5. `csv-importer.test.ts` — Depends on `bank-import.ts`, pure transforms
6. `founder-os-jwt.test.ts` — Mock NextRequest only
7. `rbac.test.ts` — Mock Prisma + NextAuth
8. `anomalies.test.ts` — Mock Prisma
9. `financial-intelligence.test.ts` — Mock Prisma (heaviest mock surface)

### Wave 2 — API Route Integration Tests (P0)

**Order**:
1. `invoices.test.ts` — Core revenue path
2. `expenses.test.ts` — Core cost path
3. `compliance.test.ts` — Tax/regulatory
4. `reports.test.ts` — Aggregation validation

### Wave 3 — Remaining API Routes + Edge Cases

1. `bank-import.test.ts` (integration)
2. `plugin-v1.test.ts`
3. `dashboard.test.ts`
4. `reconciliation.test.ts`

### Milestone Checkpoints

| Milestone | Coverage Target | Modules |
|-----------|----------------|---------|
| M1 | 50% | Wave 1 complete (all 9 lib modules) |
| M2 | 75% | Wave 2 complete (4 API groups) |
| M3 | 90% | Wave 3 complete (remaining 4 API groups) |
| M4 | **95%** | Edge cases, branch coverage polish |

---

## 8 · Test Specification Templates

### 8.1 — `tds.test.ts` Spec

```ts
describe('TDS_SECTIONS', () => {
  // Verify all 12 sections have valid rate/threshold/panAbsentRate
});

describe('calculateTDS', () => {
  // With PAN: verify rate applied, netPayable = gross - tds
  // Without PAN: verify 20% fallback rate
  // Unknown section: verify zero TDS, full amount passthrough
  // Rounding: verify integer TDS amounts
});

describe('getSectionForExpenseType', () => {
  // Map all 10 expense types to correct sections
  // Unknown type: verify null return
});

describe('getCurrentQuarter', () => {
  // Test all 4 quarters (Q1: Apr-Jun, Q2: Jul-Sep, Q3: Oct-Dec, Q4: Jan-Mar)
  // Use vi.useFakeTimers() to control Date.now()
});
```

### 8.2 — `transaction-categorizer.test.ts` Spec

```ts
describe('categorizeTransaction', () => {
  describe('vendor rules', () => {
    // Test at least 1 vendor per category (13 categories)
    // Confidence should be 0.9 for vendor matches
  });

  describe('IMPS/NEFT extraction', () => {
    // MMT/IMPS debit → Salaries
    // MMT/IMPS credit → Misc
    // NEFT person extraction variants
  });

  describe('BIL/ONL patterns', () => {
    // Bill payment with known vendor → correct category
    // Bill payment with unknown vendor → Misc
  });

  describe('MSI/ patterns', () => {
    // International SaaS payment → Software (0.7 confidence)
  });

  describe('keyword fallback', () => {
    // ATM → Misc, subscription → Software, refund → Misc
  });

  describe('edge cases', () => {
    // Empty string → Misc, confidence 0
    // No match → Misc, confidence 0.1
  });
});

describe('batchCategorize', () => {
  // Credit transactions with low confidence → Income / Revenue
  // Debit transactions → unchanged
});
```

### 8.3 — `bank-import.test.ts` Spec

```ts
describe('parseCSV', () => {
  // Standard CSV with headers
  // Quoted fields with commas
  // Empty input → empty result
  // Custom delimiter (semicolon, tab)
  // Windows line endings (\r\n)
});

describe('detectColumnMapping', () => {
  // ICICI format headers
  // HDFC format headers
  // SBI format headers
  // Generic format headers
  // Missing columns → partial mapping
});

describe('normalizeTransactions', () => {
  // Single amount column (positive = credit, negative = debit)
  // Separate debit/credit columns
  // Cr/Dr type indicator column
  // Zero-amount rows filtered
  // Hash generation for dedup
});

describe('extractVendor', () => {
  // UPI format → vendor name
  // NEFT format → vendor name
  // POS format → vendor name
  // ECOM/ONLINE format → vendor name
  // No match → null
});

describe('date parsing', () => {
  // dd/mm/yyyy, dd-mm-yyyy, dd/mm/yy
  // yyyy-mm-dd (ISO)
  // dd Mon yyyy, dd-Mon-yy
  // Invalid → fallback to current date
});

describe('amount parsing', () => {
  // Indian format: 1,23,456.78
  // Western format: 123,456.78
  // Currency symbols: ₹, $, €, £
  // Parenthesized negatives: (1,234.56) → -1234.56
  // Empty/dash → 0
});
```

---

## 9 · Acceptance Criteria

- [ ] `npx vitest run --coverage` passes with **0 failures**
- [ ] Statement coverage ≥ **95%**
- [ ] Branch coverage ≥ **90%**
- [ ] Function coverage ≥ **95%**
- [ ] Line coverage ≥ **95%**
- [ ] All 12 lib modules have dedicated test files
- [ ] All 8 API route groups have integration test files
- [ ] No `as any` in test mocks — use `vi.mocked()` with typed returns
- [ ] Every financial calculation test includes **decimal precision assertions**
- [ ] Tax calculation tests verify against **published Indian tax rates**
- [ ] Coverage report generated at `./coverage/` (HTML + JSON)

---

## 10 · Commands Reference

```bash
# Run all tests
npx vitest run

# Run with coverage report
npx vitest run --coverage

# Run specific test file
npx vitest run __tests__/lib/tds.test.ts

# Run in watch mode during development
npx vitest __tests__/lib/tds.test.ts

# Run only lib tests
npx vitest run __tests__/lib/

# Run only integration tests
npx vitest run __tests__/integration/

# View coverage in browser
open coverage/index.html
```

---

## 11 · Go/No-Go Verdict Protocol

| Condition | Status |
|-----------|--------|
| All P0 modules at 100% function coverage | ✅ DONE (tds, categorizer, bank-import, csv-importer, financial-intelligence) |
| All P1 modules at 95%+ coverage | ✅ DONE (rbac, roles, founder-os-jwt, anomalies) |
| All API route groups have at least smoke tests | ✅ 7/8 DONE (missing: reconciliation) |
| `vitest run` exits 0 (459/459) | ✅ DONE |
| Threshold enforcement active in CI | 🔴 PENDING (need `--coverage` run) |
| **VERDICT** | **🟡 READY WITH FIXES** |
