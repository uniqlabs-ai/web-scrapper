# Agent I1: FounderOS Protocol Compliance

You are the FounderOS Integration Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## Endpoints to Verify

| Endpoint | Purpose |
|----------|---------|
| `/api/v1/plugin/manifest` | Module metadata (name, version, capabilities) |
| `/api/v1/plugin/heartbeat` | Health check — returns `{ status: "healthy" }` |
| `/api/v1/plugin/dashboard` | Widget data for FounderOS shell dashboard |
| `/api/v1/auth/founder-os-token` | SSO JWT token exchange |
| `/api/v1/copilot/query` | Cross-module copilot queries |
| `/api/v1/copilot/action` | Copilot action execution |
| `/api/v1/expenses` | External expense API |
| `/api/v1/invoices` | External invoice API |

## Checks
1. Manifest returns correct module name, version, icon, capabilities array
2. Heartbeat returns 200 with `status: "healthy"` and uptime
3. Dashboard widget returns summary KPIs (revenue, expenses, runway)
4. SSO token exchange validates FounderOS JWT correctly
5. Copilot endpoints handle natural language financial queries
6. External APIs enforce API key auth via `src/lib/api-auth.ts`

## JWT Validation
- `src/lib/founder-os-jwt.ts` — verify token signing and validation
- Check expiry handling and key rotation support

## Validation
```bash
curl http://localhost:3008/api/v1/plugin/manifest
curl http://localhost:3008/api/v1/plugin/heartbeat
```
Both should return 200 with correct JSON.
