/**
 * Zod Schemas — Invoice Domain
 */
import { z } from "zod";

const LineItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.number().min(0.01, "Quantity must be > 0"),
  unitPrice: z.number().min(0, "Unit price cannot be negative").max(999_999_999),
  gstRate: z.number().min(0).max(100).default(0),
});

export const CreateInvoiceSchema = z.object({
  clientId: z.string().uuid().optional(),
  dueDate: z.string().refine((v) => !isNaN(Date.parse(v)), {
    message: "Invalid dueDate format",
  }),
  notes: z.string().max(2000).optional(),
  gstNumber: z.string().max(20).optional(),
  placeOfSupply: z.string().max(100).optional(),
  isInterState: z.boolean().default(false),
  currency: z.string().length(3).default("INR"),
  lineItems: LineItemSchema.array().min(1, "At least one line item is required"),
});

export const UpdateInvoiceStatusSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]),
});

export const RecordPaymentSchema = z.object({
  amount: z.number().positive().max(999_999_999),
  date: z.string().optional(),
  method: z.enum(["bank_transfer", "upi", "cash", "cheque", "card"]).default("bank_transfer"),
  reference: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const InvoiceReminderSchema = z.object({
  invoiceIds: z.string().uuid().array().min(1).max(50),
  message: z.string().max(2000).optional(),
});
