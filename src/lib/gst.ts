import type { GSTBreakdown } from "./types";

/**
 * GST Rate Engine — FY 2025-26
 * Standard slabs: 0%, 5%, 12%, 18%, 28%
 * E-invoice mandatory for turnover > ₹5 Cr (any FY from 2017-18 onwards)
 */
const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GSTRate = (typeof GST_RATES)[number];

/** E-invoice applicability threshold (in ₹) — PAN-level aggregate turnover */
export const E_INVOICE_THRESHOLD = 50000000; // ₹5 Crore

export function isValidGSTRate(rate: number): rate is GSTRate {
  return GST_RATES.includes(rate as GSTRate);
}

export function calculateGST(
  amount: number,
  gstRate: number,
  isInterState: boolean
): GSTBreakdown {
  const taxAmount = (amount * gstRate) / 100;

  if (isInterState) {
    return {
      subtotal: amount,
      cgst: 0,
      sgst: 0,
      igst: taxAmount,
      total: amount + taxAmount,
    };
  }

  const halfTax = taxAmount / 2;
  return {
    subtotal: amount,
    cgst: Math.round(halfTax * 100) / 100,
    sgst: Math.round(halfTax * 100) / 100,
    igst: 0,
    total: Math.round((amount + taxAmount) * 100) / 100,
  };
}

export function calculateLineItemTotal(
  quantity: number,
  unitPrice: number,
  gstRate: number,
  isInterState: boolean
): GSTBreakdown & { amount: number; quantity: number; unitPrice: number } {
  const amount = Math.round(quantity * unitPrice * 100) / 100;
  const gst = calculateGST(amount, gstRate, isInterState);
  return { ...gst, amount, quantity, unitPrice };
}

export function validateGSTNumber(gstNumber: string): boolean {
  const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstRegex.test(gstNumber.toUpperCase());
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
