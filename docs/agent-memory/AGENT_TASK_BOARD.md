# FoundrOS Finance — Multi-Agent Sprint Board

> **Sprint:** S1 — Production Hardening
> **Started:** 2026-05-12
> **Target:** GO for `finance.foundros.ai`

---

## Sprint Overview

| Agent | Role | P0 Tasks | P1 Tasks | Status |
|-------|------|----------|----------|--------|
| A0 Orchestrator | Release Governor | — | — | 🔄 Active |
| A1 Security | Auth, Validation, Isolation | 5 | 0 | ⬜ Pending |
| A2 Type Safety | TS Strict, Response Types | 2 | 3 | ⬜ Pending |
| A3 Reliability | Error Handling, Atomicity | 4 | 1 | ⬜ Pending |
| A4 Testing | Coverage ≥95% | 2 | 3 | 🔄 Active (91 tests) |
| A5 Observability | Logging, Sentry, CI | 0 | 4 | ✅ Done (5/5) |
| A6 Frontend UX | Loading States, A11y | 1 | 3 | ✅ Done (4/5) |

---

## Task Inventory

### A1 — Security
| ID | Task | Priority | Status |
|----|------|----------|--------|
| S1-SEC-001 | Zod validation on all POST/PATCH routes | P0 | ⬜ |
| S1-SEC-002 | Tenant isolation audit (102 routes) | P0 | ⬜ |
| S1-SEC-003 | API key hashing + rate limiting | P0 | ⬜ |
| S1-SEC-004 | Webhook signature verification | P0 | ⬜ |
| S1-SEC-005 | Dev login production guard | P0 | ⬜ |

### A2 — Type Safety
| ID | Task | Priority | Status |
|----|------|----------|--------|
| S1-TS-001 | Eliminate all `as any` | P0 | ⬜ |
| S1-TS-002 | Standardize API response types | P0 | ⬜ |
| S1-TS-003 | Auth return type safety | P1 | ⬜ |
| S1-TS-004 | Prisma type safety | P1 | ⬜ |
| S1-TS-005 | Financial calculation types | P1 | ⬜ |

### A3 — Reliability
| ID | Task | Priority | Status |
|----|------|----------|--------|
| S1-REL-001 | Try-catch every route | P0 | ⬜ |
| S1-REL-002 | Query boundaries (take: N) | P0 | ⬜ |
| S1-REL-003 | Financial transaction atomicity | P0 | ⬜ |
| S1-REL-004 | Webhook idempotency | P0 | ⬜ |
| S1-REL-005 | Import error handling | P1 | ⬜ |

### A4 — Testing
| ID | Task | Priority | Status |
|----|------|----------|--------|
| S1-TEST-001 | Fix runway.test.ts TS errors | P0 | ⬜ |
| S1-TEST-002 | Coverage tooling + thresholds | P0 | 🔄 |
| S1-TEST-003 | Business logic unit tests (12 libs) | P0 | 🔄 (2/12 done) |
| S1-TEST-004 | API route integration tests | P1 | ⬜ |
| S1-TEST-005 | Plugin contract tests expansion | P1 | ✅ (11 tests) |

### A5 — Observability
| ID | Task | Priority | Status |
|----|------|----------|--------|
| S1-OBS-001 | Structured logger | P1 | ✅ |
| S1-OBS-002 | Sentry integration | P1 | ✅ |
| S1-OBS-003 | Enhanced health checks | P1 | ✅ |
| S1-OBS-004 | CI pipeline | P1 | ✅ |
| S1-OBS-005 | Console cleanup | P2 | ✅ |

### A6 — Frontend UX
| ID | Task | Priority | Status |
|----|------|----------|--------|
| S1-UX-001 | Loading + error states (36 pages) | P0 | ✅ |
| S1-UX-002 | Empty states with CTAs | P1 | ✅ |
| S1-UX-003 | Responsive design audit | P1 | ✅ |
| S1-UX-004 | Accessibility audit | P1 | ✅ |
| S1-UX-005 | Branding consistency | P2 | ⬜ |

---

## Cross-Cutting Issues

| # | Issue | Discovered By | Assigned To | Status |
|---|-------|--------------|-------------|--------|
| 1 | Prisma schema needs 7.8 compat fix | Orchestrator | A2 | ⬜ |
| 2 | `prisma.config.ts` needed for Vercel | Orchestrator | A2 | ⬜ |

---

## Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Test count | 91 | ≥200 |
| Statement coverage | ~5% | ≥95% |
| `as any` count | TBD | 0 |
| Console.log count | **0** | 0 |
| Routes without try-catch | TBD | 0 |
| Routes without auth | TBD | 0 |
| Pages with loading.tsx | TBD | 36 |
