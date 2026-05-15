/**
 * Zod Schemas — Billing Domain
 */
import { z } from "zod";

export const CheckoutSchema = z.object({
  planId: z.enum(["starter", "professional", "enterprise"]),
  billingCycle: z.enum(["monthly", "annual"]).default("annual"),
  currency: z.string().min(3).max(3).default("USD"),
});

export const CopilotChatSchema = z.object({
  message: z.string().min(1).max(5000),
  conversationId: z.string().uuid().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
