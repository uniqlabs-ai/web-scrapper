# A6 Frontend UX Agent — S2 Delegation Brief

> **From:** A0 Orchestrator
> **Priority:** P1
> **Sprint:** S2 — Production Polish
> **Baseline:** 36/36 pages with loading.tsx + error.tsx

---

## Objective

Complete responsive design audit, WCAG AA accessibility audit, and clean up 42 frontend console.error statements.

## Task 1: Responsive Audit — P1

### Breakpoints
| Width | Device | Must work |
|:-----:|--------|:---------:|
| 375px | iPhone SE | ✅ |
| 768px | iPad | ✅ |
| 1024px | Laptop | ✅ |
| 1440px | Desktop | ✅ |

### Checklist per page
- [ ] No horizontal overflow (no content wider than viewport)
- [ ] Text readable at ≥ 14px on mobile
- [ ] Touch targets ≥ 44x44px
- [ ] Data tables: horizontal scroll wrapper OR card layout on mobile
- [ ] Sidebar collapses / hamburger menu on ≤ 768px
- [ ] Charts use responsive containers (not fixed width)

### Priority pages (most complex)
1. `/dashboard` — KPI cards + charts + sidebar
2. `/invoices` — data table + filters + bulk actions
3. `/expenses` — data table + category filters
4. `/reports/pnl` — P&L chart + data table
5. `/reconciliation` — split-panel matching UI

## Task 2: WCAG AA Accessibility — P1

### Requirements
1. **Color contrast** — all text meets 4.5:1 ratio (use Chrome DevTools or axe)
2. **ARIA labels** — every `<button>`, `<input>`, `<select>`, `<a>` has `aria-label` or visible `<label>`
3. **Keyboard navigation** — all functionality reachable via Tab/Enter/Escape
4. **Focus indicators** — visible `:focus-visible` rings on all focusable elements
5. **Heading hierarchy** — single `<h1>` per page, proper nesting
6. **Screen reader** — data tables have `<th>` headers, charts have `ChartAccessibilityWrapper`

### Measurement
Run Lighthouse accessibility on 5 key pages — target **≥ 90 score**:
```bash
# In Chrome DevTools → Lighthouse → Accessibility
# Test: /dashboard, /invoices, /expenses, /reports/pnl, /reconciliation
```

## Task 3: Console Cleanup — P2

**42 `console.error` calls** in page components need migration to structured logger:

```bash
# Find them all
grep -rn "console\.\(log\|warn\|error\)" src/app/ src/components/ --include="*.tsx" | grep -v "route.ts"
```

### Fix pattern
```typescript
// BEFORE
} catch (err) { console.error(err); }

// AFTER
import { log, toLogError } from '@/lib/logger';
} catch (err) { log.error('Failed to load invoices', { error: toLogError(err) }); }
```

## Task 4: Empty States — P2

Pages with data tables should show a friendly empty state:
- Invoices, Expenses, Revenue, Clients, Vendors, Payroll, Budgets, Receipts

```tsx
{items.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="text-4xl mb-4">📋</div>
    <h3 className="text-lg font-medium mb-2">No invoices yet</h3>
    <p className="text-muted-foreground mb-4">Create your first invoice to get started.</p>
    <Button onClick={() => setShowCreate(true)}>Create Invoice</Button>
  </div>
) : (
  <DataTable data={items} />
)}
```

## Completion Criteria

- [x] No horizontal overflow at 375px on any of 36 pages
- [x] Lighthouse accessibility ≥ 90 on 5 key pages
- [x] `console.error` in page components = 0
- [x] `npm run build` passes with 0 new errors
- [x] Update `docs/agent-memory/FRONTEND_UX_STATE.md` with audit results
