# A1 Security Agent — S2 Delegation Brief

> **From:** A0 Orchestrator
> **Priority:** P1
> **Sprint:** S2 — Production Polish
> **Baseline:** 2,114 tests passing, 72 Zod routes, 0 TS errors

---

## Objective

Close the last 4 tenant isolation gaps, add rate limiting to high-risk mutation endpoints, and implement CSRF origin validation.

## Task 1: Tenant Isolation (4 gaps) — P1

### Discovery
```bash
grep -rn "findMany\|findFirst\|findUnique\|update\|delete" src/app/api/ --include="route.ts" -l | while read f; do
  grep -q "requireTenant\|organizationId" "$f" || echo "UNSCOPED: $f"
done
```

### Fix pattern
```typescript
// Add at top of handler
const { userId, organizationId } = await requireTenant();

// Add to ALL where clauses
where: { organizationId, ...otherFilters }
```

## Task 2: Rate Limiting — P1

Add rate limiting to the 10 highest-risk mutation routes:
1. `src/app/api/transfer/route.ts` (POST)
2. `src/app/api/billing/checkout/route.ts` (POST)
3. `src/app/api/payroll/route.ts` (POST)
4. `src/app/api/invoices/route.ts` (POST)
5. `src/app/api/expenses/route.ts` (POST)
6. `src/app/api/revenue/route.ts` (POST)
7. `src/app/api/bank/import/route.ts` (POST)
8. `src/app/api/users/route.ts` (POST)
9. `src/app/api/organizations/route.ts` (POST/DELETE)
10. `src/app/api/recurring-expenses/route.ts` (POST)

### Implementation options (pick one)
- **Option A:** `@upstash/ratelimit` with Redis (production-grade, distributed)
- **Option B:** In-memory `Map<string, number[]>` with sliding window (simpler, single-instance)

### Pattern
```typescript
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, { window: '1m', max: 10 });
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  // ... rest of handler
}
```

## Task 3: CSRF Origin Validation — P2

Add to `src/middleware.ts`:
```typescript
// For state-changing methods, verify Origin header matches
if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
  const origin = request.headers.get('origin');
  const allowed = [process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3008'];
  if (origin && !allowed.includes(origin)) {
    return NextResponse.json({ error: 'CSRF: invalid origin' }, { status: 403 });
  }
}
```

## Task 4: CSP Headers — P2

Add to `next.config.js`:
```javascript
headers: [{ source: '/(.*)', headers: [
  { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline';" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]}]
```

## Completion Criteria

- [ ] Tenant gaps = 0
- [ ] Rate limiter on ≥ 5 high-risk routes
- [ ] CSRF origin check in middleware
- [ ] `npm test` passes (2,114+ tests, 0 failures)
