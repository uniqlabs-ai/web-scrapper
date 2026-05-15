/**
 * Multi-currency support utilities
 * Exchange rates, conversion, and formatting
 */

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  locale: string;
}

export const CURRENCIES: Currency[] = [
  { code: "INR", name: "Indian Rupee", symbol: "₹", locale: "en-IN" },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US" },
  { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE" },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", locale: "en-AE" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", locale: "en-SG" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", locale: "en-US" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-AU" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", locale: "en-CA" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", locale: "en-US" },
];

// Fallback static rates (INR per 1 unit of foreign currency)
// These are approximate and should be replaced with live rates
export const STATIC_RATES: Record<string, number> = {
  INR: 1,
  USD: 83.5,
  EUR: 90.5,
  GBP: 105.8,
  AED: 22.7,
  SGD: 62.3,
  JPY: 0.56,
  AUD: 54.6,
  CAD: 61.8,
  CHF: 94.2,
};

export function convertToINR(amount: number, fromCurrency: string, rate?: number): number {
  if (fromCurrency === "INR") return amount;
  const r = rate || STATIC_RATES[fromCurrency] || 1;
  return Math.round(amount * r * 100) / 100;
}

export function convertFromINR(amount: number, toCurrency: string, rate?: number): number {
  if (toCurrency === "INR") return amount;
  const r = rate || STATIC_RATES[toCurrency] || 1;
  return Math.round((amount / r) * 100) / 100;
}

export function formatCurrency(amount: number, currencyCode: string = "INR", opts?: { decimals?: number }): string {
  const currency = CURRENCIES.find((c) => c.code === currencyCode);
  const decimals = opts?.decimals ?? 0;
  try {
    return new Intl.NumberFormat(currency?.locale || "en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency?.symbol || ""}${amount.toFixed(decimals)}`;
  }
}

/** Compact format: ₹12.4L, $1.2M, €500K etc. */
export function formatCompact(amount: number, currencyCode: string = "INR"): string {
  const sym = getSymbol(currencyCode);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (currencyCode === "INR") {
    // Indian numbering: Cr, L, K
    if (abs >= 10000000) return `${sign}${sym}${(abs / 10000000).toFixed(1)}Cr`;
    if (abs >= 100000) return `${sign}${sym}${(abs / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${sign}${sym}${(abs / 1000).toFixed(0)}K`;
  } else {
    // Western numbering: B, M, K
    if (abs >= 1000000000) return `${sign}${sym}${(abs / 1000000000).toFixed(1)}B`;
    if (abs >= 1000000) return `${sign}${sym}${(abs / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${sign}${sym}${(abs / 1000).toFixed(0)}K`;
  }
  return `${sign}${sym}${Math.round(abs)}`;
}

/** Get currency symbol by code */
export function getSymbol(currencyCode: string = "INR"): string {
  return CURRENCIES.find((c) => c.code === currencyCode)?.symbol || currencyCode;
}

export function calculateFxGainLoss(
  originalAmount: number,
  originalRate: number,
  currentRate: number
): { gainLoss: number; percentage: number; isGain: boolean } {
  const originalINR = originalAmount * originalRate;
  const currentINR = originalAmount * currentRate;
  const gainLoss = currentINR - originalINR;
  const percentage = originalINR > 0 ? (gainLoss / originalINR) * 100 : 0;
  return { gainLoss, percentage: Math.round(percentage * 100) / 100, isGain: gainLoss >= 0 };
}
