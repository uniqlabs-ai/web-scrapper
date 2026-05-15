/**
 * Smart Import Utilities — Pure functions extracted from import/smart route
 * for testability and reusability.
 */

export type DocType = "invoice" | "bank_statement" | "financial_statement" | "unknown";

/**
 * Classify a PDF by extracting first-page text and checking markers.
 */
export function classifyPdf(firstPageText: string): DocType {
  const text = firstPageText.toUpperCase();

  // Invoice markers
  if (
    text.includes("TAX INVOICE") ||
    text.includes("SERVICE INVOICE") ||
    text.includes("PROFORMA INVOICE") ||
    (text.includes("INVOICE") && (text.includes("LINE TOTAL") || text.includes("UNIT PRICE") || text.includes("AMOUNT")))
  ) {
    return "invoice";
  }

  // Bank statement markers
  if (
    text.includes("ACCOUNT STATEMENT") ||
    text.includes("TRANSACTION DETAILS") ||
    text.includes("OPENING BALANCE") ||
    text.includes("CLOSING BALANCE") ||
    (text.includes("STATEMENT") && (text.includes("WITHDRAWAL") || text.includes("DEPOSIT"))) ||
    text.includes("VALUE DATE") ||
    text.includes("TRANSACTION DATE")
  ) {
    return "bank_statement";
  }

  // Financial statement markers
  if (
    text.includes("BALANCE SHEET") ||
    text.includes("PROFIT AND LOSS") ||
    text.includes("PROFIT & LOSS") ||
    text.includes("INCOME AND EXPENDITURE") ||
    text.includes("TRIAL BALANCE") ||
    text.includes("CASH FLOW STATEMENT") ||
    text.includes("AUDITOR") ||
    text.includes("SCHEDULE") ||
    text.includes("NOTES TO ACCOUNTS") ||
    text.includes("ITR") ||
    text.includes("INCOME TAX RETURN")
  ) {
    return "financial_statement";
  }

  return "unknown";
}

/**
 * Proper CSV split that handles quoted fields.
 */
export function csvSplit(row: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of row) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { parts.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  parts.push(cur.trim());
  return parts;
}

/**
 * Parse a date string in various formats.
 */
export function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [dd, mm, yyyy] = dateStr.split("/");
    return new Date(`${yyyy}-${mm}-${dd}`);
  }
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    const [dd, mm, yyyy] = dateStr.split("-");
    return new Date(`${yyyy}-${mm}-${dd}`);
  }
  // DD/MMM/YYYY (e.g. 01/Apr/2025)
  if (/^\d{2}\/\w{3}\/\d{4}$/.test(dateStr)) {
    return new Date(dateStr.replace(/\//g, " "));
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}
