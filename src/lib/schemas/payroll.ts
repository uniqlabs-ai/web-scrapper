/**
 * Zod Schemas — Payroll Domain
 */
import { z } from "zod";

export const CreateEmployeeSchema = z.object({
  employeeId: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  designation: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  joinDate: z.string().optional(),
  panNumber: z.string().max(10).optional(),
  uanNumber: z.string().max(20).optional(),
  bankAccount: z.string().max(30).optional(),
  bankIfsc: z.string().max(11).optional(),
  type: z.enum(["employee", "contractor"]).default("employee"),
  paymentBasis: z.enum(["fixed", "milestone", "hourly"]).optional(),
  basicSalary: z.number().min(0).max(999_999_999),
  hra: z.number().min(0).default(0),
  da: z.number().min(0).default(0),
  specialAllowance: z.number().min(0).default(0),
  otherAllowance: z.number().min(0).default(0),
  ctc: z.number().min(0).max(999_999_999),
});

export const ProcessPayrollSchema = z.object({
  employeeId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM format"),
});

export const TransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.number().positive("Amount must be positive").max(999_999_999),
  description: z.string().max(500).optional(),
  reference: z.string().max(100).optional(),
  date: z.string().optional(),
});
