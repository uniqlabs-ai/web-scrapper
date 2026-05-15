# Agent R2: Feature Parity Matrix

You are a product analyst auditing the **Finance Suite** against 4 top competitors.

## Finance Suite Current Modules (36 pages, 100+ API routes)

### Overview
- Dashboard (KPIs, charts, recent activity)
- Health Score (financial health algorithm)
- SaaS Metrics (MRR, Churn, LTV, CAC)

### Money Flow
- Invoices (CRUD, PDF gen, email, payments, auto-match)
- Expenses (CRUD, categories, OCR, approvals)
- A/P Inbox (accounts payable queue)
- Revenue (tracking, types: recurring/one-time/capital)
- Receipts (upload, OCR extraction)
- Bank (accounts, transactions, statement import)
- Reconciliation (auto-matching bank txns to expenses/invoices)

### Planning
- Budgets (department budgets, alerts)
- Forecast (runway projection, burn rate)
- Recurring Expenses (auto-detection, scheduling)
- Payroll (employee management, salary runs)

### Compliance (India-specific)
- Reports: P&L, Cash Flow, CFO Brief, Aging, Tax Summary, Period Comparison
- Accounting: Chart of Accounts, Trial Balance
- Bookkeeper AI (AI-assisted bookkeeping)
- TDS (computation, Form 16A generation)
- GST (returns filing, e-invoicing, HSN codes)
- FX Rates (multi-currency support)
- Compliance Calendar (due date tracking)
- Anomaly Detection (unusual spend alerts)

### Admin
- Multi-entity Consolidation (HQ Rollup)
- Clients (CRM-lite)
- Vendors (with fingerprinting)
- Team (user management, roles)
- Import (Smart Import: CSV + PDF auto-detection)
- Audit Log
- Settings (org config)

### AI Capabilities
- Transaction Auto-categorization (rule-based + ML)
- Vendor Fingerprinting (historical pattern matching)
- Invoice Auto-matching (amount + date fuzzy match)
- Copilot Chat (natural language financial queries)

### Integrations
- FounderOS SSO (JWT token exchange)
- Gmail Sync (invoice parsing from email)
- Stripe Webhooks (payment tracking)
- B2B Embed (/embed/invoices for white-label)

## Compare Against
1. **Zoho Books** (India)
2. **QuickBooks India**
3. **ClearTax**
4. **FreshBooks**

## Rating Scale
- **FULL**: Production-ready, feature-complete
- **PARTIAL**: Feature exists but has gaps or bugs
- **STUB**: UI exists, backend is minimal/placeholder
- **MISSING**: Not implemented at all

## Output
Create a comparison table in: `docs/analysis/FEATURE_PARITY_MATRIX.md`
