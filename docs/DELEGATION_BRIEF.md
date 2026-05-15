# Fin00 — Finance Orchestrator Delegation Brief

> **From:** Ecosystem Governor
> **To:** Finance Suite Orchestrator (`finance/docs/agent-prompts/00_ORCHESTRATOR.md`)
> **Priority:** CRITICAL
> **Date:** 2026-05-14 (updated)

---

## Current State

| Metric | Value |
|--------|-------|
| **Repo** | `uniqlabs-ai/web-scrapper` |
| **Test Files** | 205 files (195 pass, **6 fail**) |
| **Test Count** | 2,098 tests (2,081 pass, **17 fail**) |
| **Uncommitted Files** | ⚠️ **388 files** — must commit and push |
| **Vercel Deployment** | 🔴 Not set up |
| **Prisma Compat** | 🔴 Needs Prisma 7.8 fix (`prisma.config.ts`) |
| **Agent Prompts** | ✅ 7 prompts created (`docs/agent-prompts/`) |
| **Branch** | `main` |

---

## PREREQUISITE: Shared Package Audit (P0 — Do First)

> **Read `../../docs/SHARED_EXTRACTION_CONTEXT.md` before starting any other task.**

Finance is the **co-lead extraction product** for `@foundros/prisma` and `@foundros/logger`.

1. **Inventory** every file in `src/lib/` — exports, LOC, dependencies
2. **Prisma deep-dive**: Document `prisma.ts`, `tenant.ts` — PrismaPg adapter setup, pool configuration, tenant isolation. This becomes `@foundros/prisma`
3. **RBAC deep-dive**: Document `rbac.ts`, `guards.ts` — role hierarchy, permission matrix, requirePermission pattern. This becomes part of `@foundros/auth`
4. **Logger deep-dive**: Document `logger.ts` — log levels, context fields, output format. This becomes `@foundros/logger`
5. **Security deep-dive**: Document `audit.ts`, `webhooks.ts` — audit trail schema, webhook verification
6. **Output**: Create `docs/EXTRACTION_REPORT.md`

---

## Priority 0 — Stabilize & Ship

### 1. Fix 17 Failing Tests (P0)
6 test files fail — tests expect `200` for invalid input, routes now correctly return `400`.
→ **Assign to:** A4 Testing Agent

### 2. Commit & Push (P0)
388 uncommitted files. Git config: `nidish-avap` / `nidish@avapadvisory.com`.
→ **Assign to:** Orchestrator

### 3. Prisma 7.8 Compatibility (P0)
Remove `url` from schema, create `prisma.config.ts`.
→ **Assign to:** A2 Type Safety Agent

### 4. Vercel Deployment (P0)
Link Vercel, Neon DB, env vars, OAuth client `FoundrOS Finance Prod`, DNS CNAME.
→ **Assign to:** Orchestrator + A5 Observability

## Priority 1 — Continue Hardening

### 5. Agent Sprints
Execute: A1 Security → A2 TypeSafety → A3 Reliability → A5 Observability → A6 Frontend UX

### 6. DNS Setup
CNAME: `finance` → `cname.vercel-dns.com` in Namecheap.

---

## Agent Delegation Map

| Task | Agent |
|------|-------|
| Shared package audit | Orchestrator |
| Fix 17 failing tests | A4 Testing |
| Prisma 7.8 fix | A2 Type Safety |
| Commit + push | Orchestrator |
| Vercel setup | Orchestrator + A5 |

## Success Criteria
1. `docs/EXTRACTION_REPORT.md` produced
2. All 2,098 tests pass (0 failures)
3. `npm run build` succeeds
4. `finance.foundros.ai` returns HTTP 200
