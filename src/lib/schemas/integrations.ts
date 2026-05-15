/**
 * Zod Schemas — Integrations, Webhooks, Imports
 *
 * Validation for webhook payloads, inbound events, and import metadata.
 */
import { z } from "zod";

// ── V1 Inbound Webhook ────────────────────────────────────
export const InboundWebhookEventSchema = z.object({
  productId: z.string().min(1, "productId is required").max(100),
  event: z.string().min(1, "event is required").max(200),
  summary: z.string().max(2000).optional().default(""),
  data: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string().optional().default(""),
});

// ── Inbound Email Webhook ─────────────────────────────────
const EmailAttachmentSchema = z.object({
  content: z.string().min(1, "Attachment content is required"),
  filename: z.string().min(1).max(500),
  content_type: z.string().min(1).max(200),
});

export const InboundEmailWebhookSchema = z.object({
  from: z.string().min(1, "from is required").max(500),
  subject: z.string().max(1000).optional().default(""),
  attachments: z.array(EmailAttachmentSchema).min(1, "At least one attachment is required"),
});

// ── Razorpay Billing Webhook ──────────────────────────────
const RazorpayPaymentEntitySchema = z.object({
  id: z.string().min(1),
  notes: z.object({
    organizationId: z.string().optional(),
    planId: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const RazorpayPayloadSchema = z.object({
  payment: z.object({
    entity: RazorpayPaymentEntitySchema,
  }),
}).passthrough();

export const RazorpayWebhookSchema = z.object({
  event: z.string().min(1),
  payload: RazorpayPayloadSchema.optional(),
}).passthrough();

// ── V1 Create Expense (API) ───────────────────────────────
export const V1CreateExpenseSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  amount: z.coerce.number().positive("Amount must be positive").max(999_999_999),
  date: z.string().optional(),
  vendor: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  receipt: z.string().max(10000).optional(),
  paymentMethod: z.string().max(50).optional(),
  currency: z.string().length(3).default("INR"),
});

// ── V1 Create Invoice (API) ──────────────────────────────
const V1InvoiceLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.coerce.number().min(0.01),
  unitPrice: z.coerce.number().min(0).max(999_999_999),
  gstRate: z.coerce.number().min(0).max(100).optional().default(0),
});

export const V1CreateInvoiceSchema = z.object({
  dueDate: z.string().min(1, "dueDate is required"),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(V1InvoiceLineItemSchema).min(1, "At least one line item is required"),
  clientId: z.string().uuid().optional(),
  isInterState: z.boolean().optional().default(false),
  currency: z.string().length(3).default("INR"),
});

// ── File Upload Metadata ──────────────────────────────────
export const FileUploadMetaSchema = z.object({
  maxSizeMB: z.number().default(5),
  allowedMimeTypes: z.array(z.string()).default(["image/jpeg", "image/png", "application/pdf"]),
});

// ── Receipt Upload ────────────────────────────────────────
export const ReceiptUploadMetaSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().max(10 * 1024 * 1024),
});

// ── Import CSV action ─────────────────────────────────────
export const ImportCsvActionSchema = z.object({
  action: z.enum(["detect", "preview", "import"]),
  target: z.enum(["expenses", "revenue", "invoices"]),
  mapping: z.string().optional(),
});
