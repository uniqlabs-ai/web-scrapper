# A4 Testing Agent — S2 Delegation Brief

> **From:** A0 Orchestrator
> **Priority:** P1
> **Sprint:** S2 — Production Polish
> **Baseline:** 2,114 tests passing, 209 test files

---

## Objective

Measure code coverage, close gaps to ≥ 90% line coverage, and enforce thresholds in CI.

## Task 1: Measure Coverage — P0

```bash
npx vitest run --coverage
```

Report back:
1. **Overall** line/statement/branch/function percentages
2. **`src/lib/`** percentages (expected ~97%)
3. **`src/app/api/`** percentages (expected ~60-70%)
4. List of **all files below 80%** sorted by coverage ascending
5. Total uncovered line count

## Task 2: Close Gaps — P1

For each file below 80%, write targeted tests that exercise the uncovered code paths.

### Known low-coverage routes (from prior measurement)
| Route | Est. Coverage | Gap |
|-------|:------------:|-----|
| `v1/copilot/query` | ~4% | 363 lines, complex NLP branching — biggest single gap |
| `v1/copilot/action` | ~10% | Multi-action switch statement |
| `ap-inbox` | ~25% | PATCH approval flow |
| `anomalies` | ~40% | Aggregation + scoring |
| `consolidation` | ~23% | Multi-org merge |
| `recurring-expenses` | ~34% | CRUD + scheduling |
| `transfer` | ~34% | Double-entry transfer |

### Pattern (gold standard: `accounts.test.ts`)
```typescript
// 1. Mock ALL Prisma ops the route calls with rich return values
mp.expense.findMany.mockResolvedValue([{
  id: 'e1', amount: 5000, vendor: 'AWS', category: 'Software',
  organizationId: 'org-1', userId: 'u1', createdAt: new Date(),
}] as any);

// 2. Mock chained calls in sequence
mp.expense.count.mockResolvedValue(5);
mp.expense.aggregate.mockResolvedValue({ _sum: { amount: 25000 } } as any);

// 3. Test the happy path AND branch paths
it('returns aggregated anomalies', async () => { ... });
it('handles empty dataset', async () => { ... });
it('filters by date range', async () => { ... });
```

## Task 3: Enforce Thresholds — P1

Update `vitest.config.ts`:
```typescript
thresholds: {
  statements: 85,
  branches: 75,
  functions: 85,
  lines: 85,
  'src/lib/**/*.ts': {
    statements: 95,
    branches: 85,
    functions: 95,
    lines: 95,
  },
},
```

## Completion Criteria

- [ ] Coverage report generated and documented
- [ ] `src/lib/` ≥ 95% line coverage
- [ ] `src/app/api/` ≥ 80% line coverage
- [ ] Thresholds enforced in `vitest.config.ts`
- [ ] All tests pass (0 failures)
