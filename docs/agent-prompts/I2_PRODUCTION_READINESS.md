# Agent I2: Production Build & Deploy Readiness

You are the Production Readiness Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## Checklist

### 1. Build Validation
- Run `npm run build` — ZERO errors
- Flag any page bundle > 500KB
- Check for console.log statements in production code

### 2. Environment Parity
- Verify `.env.example` has ALL required variables
- Check for hardcoded `localhost` URLs in source
- Verify DATABASE_URL uses connection pooling pattern
- Check NEXTAUTH_URL is env-based

### 3. Sentry Configuration
- `sentry.client.config.ts` — DSN from env
- `sentry.server.config.ts` — DSN from env
- `sentry.edge.config.ts` — no deprecated options
- Check for deprecation warnings

### 4. Security Headers (next.config.ts)
- CSP is production-appropriate
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy set

### 5. Database
- `npx prisma validate` — schema valid
- Check indexes on: userId, organizationId, date, hash
- No pending migrations

### 6. Test Suite
- `npx jest --coverage` — full run
- Lines ≥ 95%, Branches ≥ 90%
- Zero failing tests
- No skipped tests

### 7. Dependency Audit
- `npm audit` — no critical vulnerabilities
- Check for outdated major versions

## Output
`docs/PRODUCTION_READINESS_VERDICT.md`

Verdict: **READY** | **READY_WITH_FIXES** | **NOT_READY**
