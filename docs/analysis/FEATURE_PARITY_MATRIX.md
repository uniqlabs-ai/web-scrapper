# Feature Parity Matrix — Finance by FounderOS

**Rating Scale:** FULL (production-ready) | PARTIAL (exists, has gaps) | STUB (UI only, minimal backend) | MISSING (not built)

## Core Accounting & Invoicing

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| Invoice CRUD | FULL | FULL | MISSING | FULL |
| Invoice PDF generation | FULL | FULL | MISSING | FULL |
| Invoice email sending | FULL | FULL | MISSING | FULL |
| Invoice payment tracking | FULL | FULL | MISSING | FULL |
| Invoice auto-matching | FULL | PARTIAL | MISSING | MISSING |
| Duplicate invoice detection | FULL | PARTIAL | MISSING | MISSING |
| Recurring invoices | PARTIAL | FULL | MISSING | FULL |
| Credit notes | MISSING | FULL | MISSING | FULL |
| Multi-currency invoicing | PARTIAL | FULL | MISSING | FULL |

## Expense Management

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| Expense CRUD | FULL | FULL | MISSING | FULL |
| Category management | FULL | FULL | MISSING | FULL |
| AI auto-categorization | FULL | PARTIAL | MISSING | PARTIAL |
| Receipt OCR upload | FULL | FULL | MISSING | FULL |
| Expense approvals | FULL | FULL | MISSING | MISSING |
| Vendor management | FULL | FULL | MISSING | PARTIAL |
| Vendor fingerprinting | FULL | MISSING | MISSING | MISSING |
| A/P Inbox | FULL | PARTIAL | MISSING | MISSING |

## Banking & Reconciliation

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| Bank account management | FULL | FULL | MISSING | FULL |
| Bank statement CSV import | FULL | FULL | MISSING | PARTIAL |
| Bank statement PDF import | FULL | MISSING | MISSING | MISSING |
| Live bank feeds | MISSING | FULL | MISSING | FULL |
| Auto-reconciliation | FULL | FULL | MISSING | PARTIAL |
| Bank transaction categorization | FULL | FULL | MISSING | FULL |

## Indian Compliance

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| GST invoicing (CGST/SGST/IGST) | PARTIAL | FULL | FULL | MISSING |
| GSTR-1 filing | PARTIAL | FULL (GSP) | FULL | MISSING |
| GSTR-3B filing | PARTIAL | FULL (GSP) | FULL | MISSING |
| E-invoicing (IRN) | STUB | FULL | FULL | MISSING |
| E-way bills | MISSING | FULL | FULL | MISSING |
| HSN/SAC code lookup | PARTIAL | FULL | FULL | MISSING |
| TDS computation | PARTIAL | FULL | FULL | MISSING |
| Form 16A generation | STUB | FULL | FULL | MISSING |
| Compliance calendar | PARTIAL | PARTIAL | FULL | MISSING |
| GSTR-2B reconciliation | MISSING | FULL | FULL | MISSING |

## Planning & Forecasting

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| Budget management | FULL | PARTIAL | MISSING | MISSING |
| Runway forecasting | FULL | MISSING | MISSING | MISSING |
| Recurring expense detection | FULL | PARTIAL | MISSING | MISSING |
| Cash flow forecasting | PARTIAL | PARTIAL | MISSING | MISSING |

## Payroll

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| Employee management | FULL | PARTIAL* | MISSING | MISSING |
| Salary runs | PARTIAL | PARTIAL* | MISSING | PARTIAL |
| PF/ESI/PT compliance | MISSING | MISSING | MISSING | MISSING |
| Payslip generation | MISSING | PARTIAL* | MISSING | MISSING |

*Zoho Payroll is a separate product

## Reports & Intelligence

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| P&L Statement | FULL | FULL | MISSING | FULL |
| Cash Flow Statement | FULL | FULL | MISSING | PARTIAL |
| Balance Sheet | MISSING | FULL | MISSING | FULL |
| CFO Weekly Brief (AI) | FULL | MISSING | MISSING | MISSING |
| Financial Health Score | FULL | MISSING | MISSING | MISSING |
| SaaS Metrics (MRR/Churn/LTV) | FULL | MISSING | MISSING | MISSING |
| Invoice Aging Report | FULL | FULL | MISSING | FULL |
| Tax Summary | PARTIAL | FULL | FULL | PARTIAL |
| Period Comparison | FULL | FULL | MISSING | PARTIAL |
| Anomaly Detection | FULL | MISSING | MISSING | MISSING |
| Chart of Accounts | PARTIAL | FULL | MISSING | FULL |
| Trial Balance | PARTIAL | FULL | MISSING | FULL |

## AI & Automation

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| AI Copilot Chat | PARTIAL | STUB (Zia) | MISSING | MISSING |
| AI Bookkeeper | STUB | MISSING | MISSING | MISSING |
| Transaction auto-categorization | FULL | PARTIAL | MISSING | PARTIAL |
| Smart Import (auto-detect type) | FULL | MISSING | MISSING | MISSING |
| Vendor fingerprinting | FULL | MISSING | MISSING | MISSING |

## Platform & Integration

| Feature | FounderOS | Zoho Books | ClearTax | FreshBooks |
|---------|-----------|------------|----------|------------|
| Multi-entity consolidation | STUB | PARTIAL | MISSING | MISSING |
| Team/user management | FULL | FULL | FULL | FULL |
| Role-based access (RBAC) | FULL | FULL | FULL | PARTIAL |
| Audit log | FULL | PARTIAL | MISSING | MISSING |
| Gmail invoice sync | PARTIAL | FULL | MISSING | MISSING |
| Stripe webhook integration | FULL | PARTIAL | MISSING | FULL |
| B2B embedded invoicing | PARTIAL | MISSING | MISSING | MISSING |
| FounderOS SSO/plugin protocol | FULL | N/A | N/A | N/A |
| API keys for external access | FULL | FULL | FULL | FULL |
| Onboarding wizard | FULL | FULL | MISSING | FULL |

---

## Summary Scorecard

| Module | FounderOS Score | Status |
|--------|----------------|--------|
| Invoicing | 8/10 | Strong — missing credit notes |
| Expenses | 9/10 | Best in class with AI + vendor fingerprinting |
| Banking | 7/10 | Good import, missing live bank feeds |
| Indian Compliance | 4/10 | **Biggest gap** — GST/TDS logic exists but untested, no direct filing |
| Planning | 8/10 | **Unique** — only platform with runway + burn rate |
| Payroll | 4/10 | Basic — missing statutory compliance (PF/ESI) |
| Reports | 8/10 | Strong — missing Balance Sheet |
| AI | 7/10 | **Unique differentiator** — copilot + smart import + categorization |
| Platform | 9/10 | Best — FounderOS integration, RBAC, audit log, multi-entity stub |

## Top 5 Priority Gaps

1. **Indian Compliance** — GST/TDS must be production-grade (not stubs) to be credible
2. **Balance Sheet** — Missing a fundamental financial statement
3. **Live Bank Feeds** — Can't compete with Zoho without real-time bank sync
4. **Credit Notes** — Standard accounting requirement, completely missing
5. **Payroll Statutory** — PF/ESI compliance needed for any startup with employees
