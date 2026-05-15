/**
 * Zod Schemas — Expense Domain
 *
 * All input validation for expense-related routes.
 */
import { z } from "zod";

export const CreateExpenseSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  amount: z.number().positive("Amount must be positive").max(999_999_999),
  currency: z.string().length(3).default("INR"),
  date: z.string().optional(),
  vendor: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  categoryId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  department: z.string().max(100).optional(),
  isRecurring: z.boolean().default(false),
});

export const UpdateExpenseSchema = CreateExpenseSchema.partial();

export const CreateRecurringExpenseSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().positive().max(999_999_999),
  currency: z.string().length(3).default("INR"),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  nextDueDate: z.string(),
  vendor: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  bucketName: z.string().max(100).optional(),
});

export const ExpenseApprovalSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  comments: z.string().max(1000).optional(),
});
