import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Find or create a bank account, preventing duplicates across import paths.
 *
 * Match priority:
 *   1. accountNumber (exact, if provided)
 *   2. bankName + userId (case-insensitive contains)
 *   3. "Primary Account" fallback for the user
 *   4. Create new if nothing matches
 */
export async function findOrCreateBankAccount(
  prisma: PrismaClient,
  userId: string,
  options: {
    bankName?: string;
    accountNumber?: string;
    organizationId?: string;
    accountLast4?: string;
  } = {},
): Promise<string> {
  const { bankName, accountNumber, organizationId, accountLast4 } = options;

  // 1. Exact match by account number
  if (accountNumber) {
    const byNumber = await prisma.bankAccount.findFirst({
      where: { userId, accountNumber },
      select: { id: true },
    });
    if (byNumber) return byNumber.id;
  }

  // 2. Match by bank name (case-insensitive)
  if (bankName && bankName !== "Imported" && bankName !== "Unknown") {
    const byName = await prisma.bankAccount.findFirst({
      where: { userId, bankName: { contains: bankName, mode: "insensitive" } },
      select: { id: true },
    });
    if (byName) return byName.id;
  }

  // 3. Fallback to "Primary Account"
  const primary = await prisma.bankAccount.findFirst({
    where: { userId, name: "Primary Account" },
    select: { id: true },
  });
  if (primary) return primary.id;

  // 4. Create new account
  const displayName = bankName && bankName !== "Unknown" && bankName !== "Imported"
    ? `${bankName}${accountLast4 || accountNumber ? " - " + (accountLast4 || accountNumber!.slice(-4)) : ""}`
    : "Primary Account";

  const created = await prisma.bankAccount.create({
    data: {
      name: displayName,
      bankName: bankName || "Imported",
      accountNumber: accountNumber || undefined,
      accountLast4: accountLast4 || (accountNumber ? accountNumber.slice(-4) : undefined),
      userId,
      organizationId: organizationId || undefined,
      currency: "INR",
    },
  });
  return created.id;
}

/**
 * Pre-load existing transaction hashes for a bank account within a date range.
 * Used by import routes to skip duplicates without per-row DB queries.
 */
export async function checkExistingHashes(
  prisma: PrismaClient,
  userId: string,
  bankAccountId: string,
  transactions: { date: Date; hash: string }[],
): Promise<Set<string>> {
  if (transactions.length === 0) return new Set();

  const dates = transactions.map((t) => t.date.getTime());
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  minDate.setDate(minDate.getDate() - 3);
  maxDate.setDate(maxDate.getDate() + 3);

  const existing = await prisma.bankTransaction.findMany({
    take: 10000,
    where: {
      userId,
      bankAccountId,
      date: { gte: minDate, lte: maxDate },
      hash: { not: null },
    },
    select: { hash: true },
  });

  return new Set(existing.map((t) => t.hash).filter(Boolean) as string[]);
}

interface CSVParseOptions {
  delimiter?: string;
  hasHeader?: boolean;
}

interface ParsedRow {
  [key: string]: string;
}

interface ColumnMapping {
  date: string;
  description: string;
  amount?: string;       // single amount column (negative = debit)
  debit?: string;        // separate debit column
  credit?: string;       // separate credit column
  balance?: string;
  reference?: string;
  type?: string;         // Cr/Dr indicator column
}

interface NormalizedTransaction {
  date: Date;
  description: string;
  amount: number;        // always positive
  type: "debit" | "credit";
  balance?: number;
  reference?: string;
  hash: string;          // for dedup
}

/**
 * Parse CSV text into rows. Handles quoted fields with commas.
 */
export function parseCSV(text: string, options: CSVParseOptions = {}): {
  headers: string[];
  rows: ParsedRow[];
} {
  const { delimiter = ",", hasHeader = true } = options;

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  function splitLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const allValues = lines.map(splitLine);
  const headers = hasHeader
    ? allValues[0].map((h) => h.replace(/^["']|["']$/g, ""))
    : allValues[0].map((_, i) => `column_${i}`);

  const dataRows = hasHeader ? allValues.slice(1) : allValues;

  const rows: ParsedRow[] = dataRows.map((values) => {
    const row: ParsedRow = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || "").replace(/^["']|["']$/g, "");
    });
    return row;
  });

  return { headers, rows };
}

/**
 * Auto-detect which columns map to date, amount, description, etc.
 * Supports: ICICI, HDFC, SBI, Axis, Kotak, Federal, IDFC, Yes Bank, and generic formats.
 */
export function detectColumnMapping(headers: string[]): Partial<ColumnMapping> {
  const mapping: Partial<ColumnMapping> = {};
  const lower = headers.map((h) => h.toLowerCase().trim());

  // Date column — expanded patterns for Indian banks
  const datePatterns = [
    "date", "txn date", "transaction date", "value date", "posting date",
    "txn_date", "tran date", "trans date", "s no.", "sl no",
    "value dt", "value_date", "tran_date", "booking date",
  ];
  for (const pat of datePatterns) {
    const idx = lower.findIndex((h) => h === pat || h.includes(pat));
    if (idx !== -1) {
      mapping.date = headers[idx];
      break;
    }
  }

  // Description — expanded for ICICI/HDFC variants
  const descPatterns = [
    "description", "narration", "particulars", "details",
    "transaction details", "remarks", "memo", "transaction remarks",
    "transaction particulars", "tran particulars", "payment details",
    "remark", "detail", "narrative",
  ];
  for (const pat of descPatterns) {
    const idx = lower.findIndex((h) => h === pat || h.includes(pat));
    if (idx !== -1) {
      mapping.description = headers[idx];
      break;
    }
  }

  // Amount (single column)
  const amtPatterns = ["amount", "transaction amount", "txn amount", "amt"];
  for (const pat of amtPatterns) {
    const idx = lower.findIndex((h) => h === pat || h === `${pat} (inr)` || h === `${pat}(inr)`);
    if (idx !== -1) {
      mapping.amount = headers[idx];
      break;
    }
  }

  // Debit column — expanded
  const debitPatterns = [
    "debit", "withdrawal", "debit amount", "withdrawal amount",
    "debit amt", "dr", "dr amount", "withdrawal (dr)",
    "debit(inr)", "debit (inr)",
  ];
  for (const pat of debitPatterns) {
    const idx = lower.findIndex((h) => h === pat || h.includes(pat));
    if (idx !== -1) {
      mapping.debit = headers[idx];
      break;
    }
  }

  // Credit column — expanded
  const creditPatterns = [
    "credit", "deposit", "credit amount", "deposit amount",
    "credit amt", "cr", "cr amount", "deposit (cr)",
    "credit(inr)", "credit (inr)",
  ];
  for (const pat of creditPatterns) {
    const idx = lower.findIndex((h) => h === pat || h.includes(pat));
    if (idx !== -1) {
      mapping.credit = headers[idx];
      break;
    }
  }

  // Cr/Dr type indicator column (used by some banks like ICICI)
  const typePatterns = ["cr/dr", "dr/cr", "type", "txn type", "transaction type"];
  for (const pat of typePatterns) {
    const idx = lower.findIndex((h) => h === pat);
    if (idx !== -1) {
      mapping.type = headers[idx];
      break;
    }
  }

  // Balance — expanded
  const balPatterns = [
    "balance", "closing balance", "running balance",
    "available balance", "closing bal", "bal",
    "balance (inr)", "balance(inr)",
  ];
  for (const pat of balPatterns) {
    const idx = lower.findIndex((h) => h === pat || h.includes(pat));
    if (idx !== -1) {
      mapping.balance = headers[idx];
      break;
    }
  }

  // Reference — expanded
  const refPatterns = [
    "reference", "ref no", "ref", "cheque no", "utr", "txn id",
    "chq/ref no", "chq / ref number", "reference no", "transaction id",
    "ref no.", "ref number", "cheque/ref no",
  ];
  for (const pat of refPatterns) {
    const idx = lower.findIndex((h) => h === pat || h.includes(pat));
    if (idx !== -1) {
      mapping.reference = headers[idx];
      break;
    }
  }

  return mapping;
}

/**
 * Parse an amount string, handling:
 * - Indian format (1,23,456.78)
 * - Western format (123,456.78)
 * - Currency symbols: ₹, $, €, £, ¥, RM, AED
 * - Parenthesized negatives: (1,234.56) → -1234.56
 */
function parseAmount(value: string): number {
  if (!value || value.trim() === "" || value.trim() === "-") return 0;

  // Strip all currency symbols and whitespace
  const cleaned = value
    .replace(/[₹$€£¥\s]/g, "")
    .replace(/^[A-Z]{2,3}\s*/i, "")  // strip currency codes like INR, EUR, USD, AED
    .replace(/,/g, "")
    .replace(/\((.+)\)/, "-$1");

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse date in multiple formats common in Indian bank statements.
 * Handles: dd/mm/yyyy, dd-mm-yyyy, dd/mm/yy, yyyy-mm-dd,
 *          dd Mon yyyy, dd-Mon-yy, dd-Mon-yyyy, dd Mon yy
 */
function parseDate(value: string): Date {
  if (!value) return new Date();

  // Clean whitespace
  const v = value.trim();

  // dd/mm/yyyy or dd-mm-yyyy (4-digit year)
  const ddmmyyyy = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    return new Date(
      parseInt(ddmmyyyy[3]),
      parseInt(ddmmyyyy[2]) - 1,
      parseInt(ddmmyyyy[1])
    );
  }

  // dd/mm/yy or dd-mm-yy (2-digit year)
  const ddmmyy = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (ddmmyy) {
    const year = parseInt(ddmmyy[3]);
    const fullYear = year > 50 ? 1900 + year : 2000 + year;
    return new Date(fullYear, parseInt(ddmmyy[2]) - 1, parseInt(ddmmyy[1]));
  }

  // yyyy-mm-dd (ISO)
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  }

  // dd Mon yyyy or dd-Mon-yyyy (e.g., "15 Feb 2025", "15-Feb-2025")
  const ddMonyyyy = v.match(
    /^(\d{1,2})[\s\-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-]+(\d{4})$/i
  );
  if (ddMonyyyy) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    return new Date(
      parseInt(ddMonyyyy[3]),
      months[ddMonyyyy[2].toLowerCase().substring(0, 3)],
      parseInt(ddMonyyyy[1])
    );
  }

  // dd-Mon-yy or dd Mon yy (e.g., "15-Feb-25", "15 Feb 25")
  const ddMonyy = v.match(
    /^(\d{1,2})[\s\-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-]+(\d{2})$/i
  );
  if (ddMonyy) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const year = parseInt(ddMonyy[3]);
    const fullYear = year > 50 ? 1900 + year : 2000 + year;
    return new Date(
      fullYear,
      months[ddMonyy[2].toLowerCase().substring(0, 3)],
      parseInt(ddMonyy[1])
    );
  }

  // Fallback to JS Date parsing
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Generate a hash for deduplication.
 */
function generateHash(date: string, description: string, amount: string): string {
  const input = `${date}|${description}|${amount}`;
  return createHash("sha256").update(input).digest("hex").substring(0, 16);
}

/**
 * Normalize parsed CSV rows into structured transactions.
 * Handles: single amount, separate debit/credit, Cr/Dr type indicator column.
 */
export function normalizeTransactions(
  rows: ParsedRow[],
  mapping: ColumnMapping
): NormalizedTransaction[] {
  return rows
    .map((row) => {
      const dateStr = row[mapping.date] || "";
      const description = row[mapping.description] || "Unknown";
      let amount = 0;
      let type: "debit" | "credit" = "debit";

      if (mapping.amount) {
        const val = parseAmount(row[mapping.amount]);

        // Check for a Cr/Dr type indicator column
        if (mapping.type) {
          const typeVal = (row[mapping.type] || "").toLowerCase().trim();
          amount = Math.abs(val);
          type = typeVal === "cr" || typeVal === "credit" || typeVal === "c" ? "credit" : "debit";
        } else {
          amount = Math.abs(val);
          type = val < 0 ? "debit" : "credit";
        }
      } else if (mapping.debit || mapping.credit) {
        const debitVal = mapping.debit ? parseAmount(row[mapping.debit]) : 0;
        const creditVal = mapping.credit ? parseAmount(row[mapping.credit]) : 0;
        if (debitVal > 0) {
          amount = debitVal;
          type = "debit";
        } else if (creditVal > 0) {
          amount = creditVal;
          type = "credit";
        }
      }

      // Skip zero-amount rows (headers, totals, blank lines)
      if (amount === 0) return null;

      const balance = mapping.balance ? parseAmount(row[mapping.balance]) : undefined;
      const reference = mapping.reference ? row[mapping.reference] : undefined;

      return {
        date: parseDate(dateStr),
        description: description.trim(),
        amount,
        type,
        balance: balance || undefined,
        reference: reference || undefined,
        hash: generateHash(dateStr, description, amount.toString()),
      };
    })
    .filter(Boolean) as NormalizedTransaction[];
}

/**
 * Extract vendor name from transaction description using heuristics.
 * Supports: UPI, NEFT, IMPS, RTGS, POS, ECOM, and common formats.
 */
export function extractVendor(description: string): string | null {
  // UPI: UPI/VENDOR/REF or UPI-VENDOR-REF
  const upi = description.match(/UPI[\/\-]([^\/\-]+)/i);
  if (upi) return upi[1].trim();

  // NEFT/IMPS/RTGS: NEFT/IMPS-VENDOR-REF
  const neft = description.match(/(?:NEFT|IMPS|RTGS)[\/\-]([^\/\-]+)/i);
  if (neft) return neft[1].trim();

  // POS: POS/VENDOR NAME
  const pos = description.match(/POS[\/\- ]+(.+?)(?:\/|$)/i);
  if (pos) return pos[1].trim();

  // Online/ECOM: ONLINE/VENDOR or ECOM/VENDOR
  const online = description.match(/(?:ONLINE|ECOM|DCH|NACH)[\/\-]([^\/\-]+)/i);
  if (online) return online[1].trim();

  // BIL/INB: Bill payment or internet banking
  const bil = description.match(/(?:BIL|INB)[\/\-]([^\/\-]+)/i);
  if (bil) return bil[1].trim();

  return null;
}
