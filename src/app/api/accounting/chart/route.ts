import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const JournalEntrySchema = z.object({
  date: z.string().optional(),
  narration: z.string().min(1, "Narration is required").max(500),
  entries: z.array(z.object({
    accountCode: z.string().min(1).max(20),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
  })).min(2, "Minimum 2 entries required"),
});

/**
 * Chart of Accounts — standard account types for double-entry
 * GET /api/accounting/chart — list accounts
 * GET /api/accounting/chart?view=balance-sheet — generate balance sheet
 * POST /api/accounting/chart — record journal entry
 */

// Standard Chart of Accounts for Indian startups
const CHART_OF_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Cash & Bank", type: "asset", subtype: "current", balance: 0 },
  { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "current", balance: 0 },
  { code: "1200", name: "Prepaid Expenses", type: "asset", subtype: "current", balance: 0 },
  { code: "1300", name: "TDS Receivable", type: "asset", subtype: "current", balance: 0 },
  { code: "1400", name: "GST Input Credit", type: "asset", subtype: "current", balance: 0 },
  { code: "1500", name: "Fixed Deposits", type: "asset", subtype: "current", balance: 0 },
  { code: "2000", name: "Office Equipment", type: "asset", subtype: "fixed", balance: 0 },
  { code: "2100", name: "Furniture & Fixtures", type: "asset", subtype: "fixed", balance: 0 },
  { code: "2200", name: "Computer & Software", type: "asset", subtype: "fixed", balance: 0 },
  { code: "2900", name: "Accumulated Depreciation", type: "asset", subtype: "fixed", balance: 0 },

  // Liabilities
  { code: "3000", name: "Accounts Payable", type: "liability", subtype: "current", balance: 0 },
  { code: "3100", name: "GST Payable", type: "liability", subtype: "current", balance: 0 },
  { code: "3200", name: "TDS Payable", type: "liability", subtype: "current", balance: 0 },
  { code: "3300", name: "Salaries Payable", type: "liability", subtype: "current", balance: 0 },
  { code: "3400", name: "PF Payable", type: "liability", subtype: "current", balance: 0 },
  { code: "3500", name: "ESI Payable", type: "liability", subtype: "current", balance: 0 },
  { code: "3600", name: "Professional Tax Payable", type: "liability", subtype: "current", balance: 0 },
  { code: "4000", name: "Long-term Loans", type: "liability", subtype: "non-current", balance: 0 },

  // Equity
  { code: "5000", name: "Share Capital", type: "equity", subtype: "capital", balance: 0 },
  { code: "5100", name: "Retained Earnings", type: "equity", subtype: "retained", balance: 0 },
  { code: "5200", name: "Current Year P&L", type: "equity", subtype: "pnl", balance: 0 },

  // Revenue
  { code: "6000", name: "Service Revenue", type: "revenue", subtype: "operating", balance: 0 },
  { code: "6100", name: "Product Revenue", type: "revenue", subtype: "operating", balance: 0 },
  { code: "6200", name: "Interest Income", type: "revenue", subtype: "other", balance: 0 },
  { code: "6300", name: "Other Income", type: "revenue", subtype: "other", balance: 0 },

  // Expenses
  { code: "7000", name: "Salaries & Wages", type: "expense", subtype: "operating", balance: 0 },
  { code: "7100", name: "Rent", type: "expense", subtype: "operating", balance: 0 },
  { code: "7200", name: "Software & Subscriptions", type: "expense", subtype: "operating", balance: 0 },
  { code: "7300", name: "Marketing & Advertising", type: "expense", subtype: "operating", balance: 0 },
  { code: "7400", name: "Travel & Conveyance", type: "expense", subtype: "operating", balance: 0 },
  { code: "7500", name: "Professional Fees", type: "expense", subtype: "operating", balance: 0 },
  { code: "7600", name: "Utilities", type: "expense", subtype: "operating", balance: 0 },
  { code: "7700", name: "Depreciation", type: "expense", subtype: "non-cash", balance: 0 },
  { code: "7800", name: "Bank Charges", type: "expense", subtype: "operating", balance: 0 },
  { code: "7900", name: "Miscellaneous Expenses", type: "expense", subtype: "operating", balance: 0 },
];

// In-memory journal entries (in production this would be a DB table)
const journalEntries: Array<{
  id: string;
  date: string;
  narration: string;
  entries: { accountCode: string; debit: number; credit: number }[];
  createdAt: string;
}> = [];

export async function GET(request: NextRequest) {
  try {
    await requireTenant();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view");

    if (view === "balance-sheet") {
      // Generate Balance Sheet from chart of accounts
      const accounts = CHART_OF_ACCOUNTS.map((a) => {
        // Sum journal entries for each account
        let balance = 0;
        for (const je of journalEntries) {
          for (const entry of je.entries) {
            if (entry.accountCode === a.code) {
              if (a.type === "asset" || a.type === "expense") {
                balance += entry.debit - entry.credit;
              } else {
                balance += entry.credit - entry.debit;
              }
            }
          }
        }
        return { ...a, balance };
      });

      const assets = accounts.filter((a) => a.type === "asset");
      const liabilities = accounts.filter((a) => a.type === "liability");
      const equity = accounts.filter((a) => a.type === "equity");

      const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
      const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
      const totalEquity = equity.reduce((s, a) => s + a.balance, 0);

      return NextResponse.json({
        balanceSheet: {
          assets: { current: assets.filter((a) => a.subtype === "current"), fixed: assets.filter((a) => a.subtype === "fixed"), total: totalAssets },
          liabilities: { current: liabilities.filter((a) => a.subtype === "current"), nonCurrent: liabilities.filter((a) => a.subtype === "non-current"), total: totalLiabilities },
          equity: { items: equity, total: totalEquity },
          totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
          isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
        },
        journalCount: journalEntries.length,
      });
    }

    if (view === "journal") {
      return NextResponse.json({
        entries: journalEntries.sort((a, b) => b.date.localeCompare(a.date)),
      });
    }

    // Default: list chart
    return NextResponse.json({
      accounts: CHART_OF_ACCOUNTS,
      groups: {
        assets: CHART_OF_ACCOUNTS.filter((a) => a.type === "asset").length,
        liabilities: CHART_OF_ACCOUNTS.filter((a) => a.type === "liability").length,
        equity: CHART_OF_ACCOUNTS.filter((a) => a.type === "equity").length,
        revenue: CHART_OF_ACCOUNTS.filter((a) => a.type === "revenue").length,
        expenses: CHART_OF_ACCOUNTS.filter((a) => a.type === "expense").length,
      },
    });
  } catch (error) {
    log.error("Accounting error", { module: "accounting", action: "chart", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireTenant();
    const rawBody = await request.json();

    const parsed = JournalEntrySchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;
    const { date, narration, entries } = body;

    // Validate double-entry: total debits must equal total credits
    const totalDebit = entries.reduce((s: number, e: { debit: number }) => s + (e.debit || 0), 0);
    const totalCredit = entries.reduce((s: number, e: { credit: number }) => s + (e.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return NextResponse.json({
        error: `Debits (${totalDebit}) must equal credits (${totalCredit})`,
      }, { status: 400 });
    }

    const je = {
      id: `JE-${String(journalEntries.length + 1).padStart(4, "0")}`,
      date: date || new Date().toISOString().slice(0, 10),
      narration,
      entries,
      createdAt: new Date().toISOString(),
    };

    journalEntries.push(je);

    return NextResponse.json(je, { status: 201 });
  } catch (error) {
    log.error("Journal entry error", { module: "accounting", action: "chart", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
