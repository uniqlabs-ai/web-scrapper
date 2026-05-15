/**
 * Zod Schemas — Bank Domain
 */
import { z } from "zod";

export const CreateBankAccountSchema = z.object({
  name: z.string().min(1).max(200),
  bankName: z.string().max(200).optional(),
  accountNumber: z.string().max(30).optional(),
  accountLast4: z.string().max(4).optional(),
  accountType: z.enum(["savings", "current", "overdraft", "cc", "other"]).default("savings"),
  ifscCode: z.string().max(11).optional(),
  bankEmailDomains: z.string().max(500).optional(),
  currentBalance: z.number().default(0),
  currency: z.string().length(3).default("INR"),
});

export const BankImportSchema = z.object({
  bankAccountId: z.string().uuid(),
  transactions: z.array(z.object({
    date: z.string(),
    description: z.string().min(1).max(500),
    reference: z.string().max(100).optional(),
    amount: z.number(),
    type: z.enum(["debit", "credit"]).default("debit"),
    balance: z.number().optional(),
    category: z.string().max(100).optional(),
  })).min(1).max(5000),
});

export const ReconciliationSchema = z.object({
  bankTransactionId: z.string().uuid(),
  matchedExpenseId: z.string().uuid().optional(),
  matchedInvoiceId: z.string().uuid().optional(),
  action: z.enum(["match", "unmatch", "ignore"]),
});

export const CreateBankTransactionSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1).max(500),
  amount: z.coerce.number(),
  type: z.enum(["debit", "credit"]),
  bankAccountId: z.string().uuid(),
  category: z.string().max(100).optional(),
  vendor: z.string().max(200).optional(),
  reference: z.string().max(100).optional(),
  hash: z.string().max(200).optional(),
});
