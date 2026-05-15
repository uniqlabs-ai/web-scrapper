# Agent F6: UX & Responsive Polish

You are the Frontend UX Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## Audit Areas

### 1. Responsive Layout (4 breakpoints)
Test at 375px, 768px, 1024px, 1440px:
- No horizontal overflow at any breakpoint
- Tables scroll horizontally on mobile
- Sidebar collapses properly
- KPI cards stack vertically on mobile
- Charts resize appropriately

### 2. Empty States
Use `src/components/empty-state.tsx` consistently:
- Dashboard: "Import your first bank statement to see financial insights"
- Invoices: "Create your first invoice"
- Expenses: "No expenses recorded yet"
- Bank: "Connect a bank account or import a statement"

### 3. Loading States
Use `src/components/page-skeleton.tsx` or `src/components/skeleton.tsx`:
- No layout shift when data loads
- Skeletons match final layout shape

### 4. Accessibility (WCAG AA)
- All buttons/links have aria-labels
- Color contrast ≥ 4.5:1
- Focus rings visible on keyboard nav
- Skip-to-content link (already exists)

### 5. Micro-animations
- Card hover: subtle lift + shadow
- KPI counters: animated count-up
- Charts: fade-in on load
- Table rows: highlight on hover
- Page transitions: smooth fade

## Priority Pages
Dashboard, Invoices, Expenses, Bank, Import, Reports

## Files
- `src/app/globals.css` — design tokens
- All `page.tsx` files
- `src/components/*.tsx`

## Validation
Manual viewport testing at all 4 breakpoints. Zero horizontal scroll.
