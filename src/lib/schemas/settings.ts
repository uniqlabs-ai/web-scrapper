/**
 * Zod Schemas — Settings, Budgets, Categories
 */
import { z } from "zod";

export const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  currency: z.string().length(3).optional(),
  gstNumber: z.string().max(20).optional(),
  address: z.string().max(1000).optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  alertSettings: z.string().max(5000).optional(),
  brandColor: z.string().max(7).optional(),
  knowledgeBase: z.string().max(10000).optional(),
  domainWhitelist: z.string().max(1000).optional(),
});

export const CreateBudgetSchema = z.object({
  category: z.string().min(1).max(100),
  monthlyLimit: z.number().positive().max(999_999_999),
  alertAt: z.number().min(0).max(1).default(0.8),
});

export const UpdateBudgetSchema = CreateBudgetSchema.partial();

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(50).optional(),
  color: z.string().max(7).optional(),
});

export const OnboardingSchema = z.object({
  companyName: z.string().min(1).max(200),
  currency: z.string().length(3).default("INR"),
  gstNumber: z.string().max(20).optional(),
  industry: z.string().max(100).optional(),
});

export const CreateRevenueSchema = z.object({
  month: z.string(),
  amount: z.number().positive().max(999_999_999),
  currency: z.string().length(3).default("INR"),
  type: z.enum(["recurring", "one_time", "one-time"]).default("recurring"),
  category: z.string().max(100).optional(),
  source: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  clientId: z.string().uuid().optional(),
});
