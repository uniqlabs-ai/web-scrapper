/**
 * Zod Schemas — Vendor & Client Domain
 */
import { z } from "zod";

export const CreateVendorSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  company: z.string().max(200).optional(),
  gstNumber: z.string().max(20).optional(),
  panNumber: z.string().max(10).optional(),
  bankName: z.string().max(200).optional(),
  bankAccount: z.string().max(30).optional(),
  bankIfsc: z.string().max(11).optional(),
  paymentTerms: z.number().int().min(0).max(365).default(30),
  address: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  displayName: z.string().max(100).optional(),
});

export const UpdateVendorSchema = CreateVendorSchema.partial();

export const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  company: z.string().max(200).optional(),
  gstNumber: z.string().max(20).optional(),
  address: z.string().max(1000).optional(),
  displayName: z.string().max(100).optional(),
});

export const UpdateClientSchema = CreateClientSchema.partial();
