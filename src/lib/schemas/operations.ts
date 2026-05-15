/**
 * Zod Schemas — Operations (copilot, onboarding, audit, imports, receipts, misc)
 *
 * Catch-all schema file for routes that don't fit neatly into
 * a single financial domain.
 */
import { z } from "zod";

// CopilotChatSchema is in billing.ts — do not duplicate here
export const CopilotActionSchema = z.object({
  action: z.enum(["createInvoice", "logExpense", "recordRevenue"]),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const CopilotQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  orgId: z.string().optional(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: z.any().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

// ── AP Inbox ───────────────────────────────────────────────
export const ApInboxApprovalSchema = z.object({
  approvalId: z.string().min(1, "approvalId is required"),
  action: z.enum(["approve", "reject"]),
  finalAmount: z.number().positive().optional(),
  finalVendor: z.string().max(200).optional(),
  finalCategory: z.string().max(200).optional(),
});

// ── Onboarding ─────────────────────────────────────────────
export const OnboardingCompleteSchema = z.object({
  companyName: z.string().min(1).max(200),
  companyType: z.string().max(50).default("LLP"),
  currency: z.string().length(3).default("INR"),
  gstin: z.string().max(20).optional(),
  gstNumber: z.string().max(20).optional(),
  pan: z.string().max(10).optional(),
  industry: z.string().max(100).optional(),
  cashInBank: z.coerce.number().min(0).optional(),
  address: z.string().max(1000).optional(),
  fyStart: z.string().max(20).default("april"),
});

// ── TDS ────────────────────────────────────────────────────
export const TdsComputeSchema = z.object({
  category: z.string().min(1, "TDS category is required").max(100),
  amount: z.coerce.number().positive("Amount must be positive").max(999_999_999),
  vendorType: z.enum(["company", "individual", "huf", "partnership", "trust"]).default("company"),
});

// ── Users ──────────────────────────────────────────────────
export const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(200).optional(),
  role: z.enum(["admin", "accountant", "viewer", "approver", "custom"]).optional(),
  permissions: z.any().optional().nullable(),
  isActive: z.boolean().optional(),
}).passthrough();

export const UpdateUserRoleSchema = z.object({
  role: z.enum(["admin", "accountant", "viewer", "approver", "custom"]).optional(),
  fullName: z.string().min(1).max(200).optional(),
  permissions: z.any().optional().nullable(),
}).passthrough();

// ── Organizations ──────────────────────────────────────────
export const SwitchOrganizationSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
}).passthrough();

export const UpdateOrganizationSettingsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  currency: z.string().length(3).optional(),
  gstNumber: z.string().max(20).optional(),
  address: z.string().max(1000).optional(),
  cashInBank: z.coerce.number().min(0).optional(),
  alertSettings: z.any().optional(),
  brandColor: z.string().max(7).optional(),
  knowledgeBase: z.string().max(10000).optional(),
  invoicePrefix: z.string().max(10).optional(),
  invoiceFooter: z.string().max(2000).optional(),
  reminderDays: z.coerce.number().min(0).max(90).optional(),
  bankName: z.string().max(200).optional(),
  bankAccountNumber: z.string().max(30).optional(),
  bankIfsc: z.string().max(11).optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
}).passthrough();

// ── Bank Transactions ──────────────────────────────────────
export const UpdateBankTransactionSchema = z.object({
  id: z.string().min(1, "Transaction ID is required"),
  category: z.string().max(200).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  vendor: z.string().max(200).optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isReconciled: z.boolean().optional(),
});

export const BulkCategorizeBankTxnSchema = z.object({
  updates: z.array(z.object({
    id: z.string().min(1),
    categoryId: z.string().uuid().optional().nullable(),
    vendorId: z.string().uuid().optional().nullable(),
  })).min(1).max(500),
});

// ── Expenses ───────────────────────────────────────────────
export const ExpenseApprovalActionSchema = z.object({
  expenseId: z.string().min(1, "expenseId is required"),
  action: z.enum(["submit", "approve", "reject", "reimburse"]),
  notes: z.string().max(2000).optional(),
});

// ── Invoices ───────────────────────────────────────────────
export const UpdateInvoiceSchema = z.object({
  notes: z.string().max(2000).optional(),
  dueDate: z.string().optional(),
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]).optional(),
});

export const InvoiceEmailSchema = z.object({
  to: z.string().email("Valid email is required"),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().max(5000).optional(),
  cc: z.string().email().optional(),
});

// ── Reconciliation ─────────────────────────────────────────
export const AutoReconcileSchema = z.object({
  bankAccountId: z.string().min(1, "Bank account ID is required"),
  threshold: z.coerce.number().min(0).max(1).default(0.9),
});

// ── Receipts ───────────────────────────────────────────────
export const LinkReceiptSchema = z.object({
  expenseId: z.string().uuid("Valid expense ID required"),
  url: z.string().url().optional(),
  notes: z.string().max(1000).optional(),
});

// ── Vendor Fingerprints ────────────────────────────────────
export const VendorFingerprintSchema = z.object({
  vendor: z.string().min(1, "vendor name is required").max(200),
  categoryId: z.string().uuid("Valid category ID required"),
  pattern: z.string().min(1).max(500).optional(),
}).passthrough();

// ── GST ────────────────────────────────────────────────────
export const GstCleartaxSchema = z.object({
  action: z.string().min(1).max(50),
  period: z.string().max(20).optional(),
  gstin: z.string().max(15).optional(),
}).passthrough();

// ── Chart of Accounts ──────────────────────────────────────
export const CreateAccountEntrySchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(20).optional(),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  parentId: z.string().uuid().optional(),
  description: z.string().max(500).optional(),
});

// ── Recurring Expense [id] ─────────────────────────────────
export const UpdateRecurringExpenseSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  amount: z.coerce.number().nonnegative().max(999_999_999).optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "annual"]).optional(),
  vendor: z.string().max(200).optional(),
  categoryId: z.string().optional().nullable(),
  notes: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
  aliases: z.string().max(2000).optional(),
});
