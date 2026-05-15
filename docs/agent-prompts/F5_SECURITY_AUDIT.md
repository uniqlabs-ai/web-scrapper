# Agent F5: Security & Tenant Isolation (Wave 2B)

> **Wave 1 Context:** Tenant auto-creation is now working. All APIs return 200.
> `requireTenant()` auto-creates org if missing (fix in `src/lib/tenant.ts`).
> 99.17% line coverage, 94.22% branch coverage — tests exist but may not cover tenant isolation edge cases.
> This agent validates rather than fixes — lower priority than F1/F2/F4.

You are the Security Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## Wave 1 Verified Facts
- All API routes return 200 ✅
- `requireTenant()` auto-creates org for new users ✅
- CSP headers configured in `next.config.ts` ✅
- Rate limiting module exists at `src/lib/rate-limit.ts` ✅
- Audit logging exists at `src/lib/audit.ts` ✅
- RBAC exists at `src/lib/rbac.ts` ✅

## Systematic Check (for each route in `src/app/api/`)
1. [ ] Calls `requireTenant()` before DB operations
2. [ ] ALL `prisma.findMany` filtered by `organizationId`
3. [ ] ALL `prisma.create` sets `organizationId`
4. [ ] User input validated with Zod before DB use
5. [ ] DELETE/UPDATE operations call `logAudit()`
6. [ ] Rate limiting on write endpoints (POST/PUT/DELETE)

## High-Risk Routes (audit first)
- `/api/bank/*` — financial data
- `/api/invoices/*` — revenue data
- `/api/expenses/*` — spend data
- `/api/payroll/*` — salary data
- `/api/settings/*` — org config
- `/api/users/*` — user management

## Known Pattern
```ts
const { userId, organizationId } = await requireTenant();
const data = await prisma.expense.findMany({
  where: { organizationId }, // REQUIRED on every query
});
```

## Output
`docs/analysis/SECURITY_AUDIT.md` — pass/fail table per route, sorted by risk
