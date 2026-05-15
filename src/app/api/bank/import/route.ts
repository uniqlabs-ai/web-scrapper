import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  parseCSV,
  detectColumnMapping,
  normalizeTransactions,
  extractVendor,
  findOrCreateBankAccount,
} from "@/lib/bank-import";
import {
  categorizeTransaction as _categorizeTransaction,
  batchCategorize,
} from "@/lib/transaction-categorizer";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const BankImportFileSchema = z.object({
  fileName: z.string().min(1).max(500),
  sizeBytes: z.number().max(50 * 1024 * 1024, "File exceeds 50MB limit"),
});

/**
 * Convert a PDF bank statement to CSV using the pdfplumber Python script.
 * Returns { csvText, metadata } on success.
 */
function convertPdfToCsv(pdfBuffer: Buffer, _originalName: string): {
  csvText: string;
  metadata: {
    account_number: string;
    bank_name: string;
    period_from: string;
    period_to: string;
    transaction_count: number;
    total_debit: number;
    total_credit: number;
  };
} {
  const tempPdf = join(tmpdir(), `statement_${Date.now()}.pdf`);
  const tempCsv = join(tmpdir(), `statement_${Date.now()}.csv`);

  try {
    writeFileSync(tempPdf, pdfBuffer);

    const scriptPath = join(process.cwd(), "scripts", "extract_pdf_statement.py");
    const result = execSync(
      `python3 "${scriptPath}" "${tempPdf}" "${tempCsv}"`,
      { encoding: "utf-8", timeout: 30000 }
    );

    const metadata = JSON.parse(result.trim());
    if (!metadata.success) {
      throw new Error(metadata.error || "PDF extraction failed");
    }

    const csvText = readFileSync(tempCsv, "utf-8");
    return { csvText, metadata };
  } finally {
    // Cleanup temp files
    try { if (existsSync(tempPdf)) unlinkSync(tempPdf); } catch (e: unknown) {
      log.warn("Failed to cleanup temp PDF", { module: "bank", action: "import", meta: { error: e instanceof Error ? e.message : String(e) } });
    }
    try { if (existsSync(tempCsv)) unlinkSync(tempCsv); } catch (e: unknown) {
      log.warn("Failed to cleanup temp CSV", { module: "bank", action: "import", meta: { error: e instanceof Error ? e.message : String(e) } });
    }
  }
}

/**
 * POST /api/bank/import — Upload CSV or PDF bank statement
 * Body: FormData with "file" and optional "bankAccountId", "columnMapping" (JSON)
 * Supports: .csv, .txt, .pdf
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 5, prefix: "bank-import" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bankAccountId = formData.get("bankAccountId") as string | null;
    const customMapping = formData.get("columnMapping") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileMeta = BankImportFileSchema.safeParse({ fileName: file.name, sizeBytes: file.size });
    if (!fileMeta.success) {
      return NextResponse.json({ error: "Validation failed", details: fileMeta.error.issues }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    let text: string;
    let _pdfMetadata: Record<string, unknown> | null = null;

    // ── PDF Support ──────────────────────────────────────────
    if (name.endsWith(".pdf")) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const { csvText, metadata } = convertPdfToCsv(buffer, file.name);
        text = csvText;
        _pdfMetadata = metadata as Record<string, unknown>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { error: `PDF extraction failed: ${msg}. Ensure pdfplumber is installed (pip3 install pdfplumber).` },
          { status: 422 }
        );
      }
    } else if (name.endsWith(".csv") || name.endsWith(".txt")) {
      text = await file.text();
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a CSV or PDF bank statement." },
        { status: 400 }
      );
    }

    // Parse CSV
    const { headers, rows } = parseCSV(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No transaction data found in the file" },
        { status: 400 }
      );
    }

    // Use custom mapping or auto-detect
    const mapping = customMapping
      ? JSON.parse(customMapping)
      : detectColumnMapping(headers);

    if (!mapping.date || !mapping.description) {
      return NextResponse.json(
        {
          error: "Could not auto-detect columns. Please provide column mapping.",
          headers,
          detectedMapping: mapping,
        },
        { status: 422 }
      );
    }

    // Ensure at least one amount column
    if (!mapping.amount && !mapping.debit && !mapping.credit) {
      return NextResponse.json(
        {
          error: "No amount/debit/credit column detected.",
          headers,
          detectedMapping: mapping,
        },
        { status: 422 }
      );
    }

    // Normalize transactions
    const transactions = normalizeTransactions(rows, mapping);

    // Ensure bank account exists (create default if none provided)
    let accountId = bankAccountId;
    if (!accountId) {
      accountId = await findOrCreateBankAccount(prisma, userId, {
        organizationId,
      });
    }

    // Create import batch
    const batch = await prisma.importBatch.create({
      data: {
        type: "bank_csv",
        fileName: file.name,
        rowCount: transactions.length,
        status: "processing",
        columnMapping: JSON.stringify(mapping),
        userId,
      },
    });

    // ── Vendor Fingerprinting: pre-categorize from history ──
    // Build vendor→category map from historical expenses for instant categorization
    const historicalExpenses = await prisma.expense.findMany({
      take: 500,
      where: { userId, categoryId: { not: null } },
      select: { vendor: true, category: { select: { name: true } } },
    });

    const vendorCategoryMap: Record<string, Record<string, number>> = {};
    for (const e of historicalExpenses) {
      const v = (e.vendor || "").trim();
      if (!v) continue;
      const c = e.category?.name || "";
      if (!c) continue;
      if (!vendorCategoryMap[v]) vendorCategoryMap[v] = {};
      vendorCategoryMap[v][c] = (vendorCategoryMap[v][c] || 0) + 1;
    }

    // Build fingerprint: vendor → dominant category (only if 80%+ consistent)
    const vendorFingerprints: Record<string, { category: string; confidence: number }> = {};
    for (const [vendor, cats] of Object.entries(vendorCategoryMap)) {
      const total = Object.values(cats).reduce((s, v) => s + v, 0);
      if (total < 2) continue; // Need at least 2 data points
      const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
      const dominant = sorted[0];
      const pct = dominant[1] / total;
      if (pct >= 0.8) {
        vendorFingerprints[vendor.toLowerCase()] = { category: dominant[0], confidence: Math.round(pct * 100) / 100 };
      }
    }

    // Categorize all transactions (fingerprint first, then rule-based fallback)
    const categorized = batchCategorize(
      transactions.map((t) => ({
        description: t.description,
        amount: t.amount,
        type: t.type,
      }))
    );

    // Apply vendor fingerprints where available (overrides rule-based)
    for (let i = 0; i < transactions.length; i++) {
      const vendor = (extractVendor(transactions[i].description) || categorized[i].vendor || "").toLowerCase();
      if (vendor && vendorFingerprints[vendor]) {
        categorized[i].category = vendorFingerprints[vendor].category;
        categorized[i].confidence = vendorFingerprints[vendor].confidence;
      }
    }

    // Bulk insert, skipping duplicates
    let imported = 0;
    let skipped = 0;
    let expensesCreated = 0;
    let revenueCreated = 0;
    type ExistingTxn = { id: string; hash: string | null; amount: number; date: Date; type: string; description: string };
    const conflicts: { incoming: Record<string, unknown>; existing: ExistingTxn }[] = [];

    // Get user's org for expense/revenue records
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    // ── Duplicate Detection v2 (Fuzzy Matching) ──
    const existingHashes = new Set<string>();
    let existingTxns: ExistingTxn[] = [];
    
    if (transactions.length > 0) {
      const dates = transactions.map(t => t.date.getTime());
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      minDate.setDate(minDate.getDate() - 3);
      maxDate.setDate(maxDate.getDate() + 3);

      const dbTxns = await prisma.bankTransaction.findMany({
      take: 500,
        where: {
          userId,
          bankAccountId: accountId!,
          date: { gte: minDate, lte: maxDate }
        },
        select: { id: true, hash: true, amount: true, date: true, type: true, description: true },
      });
      existingTxns = dbTxns.map(t => ({ ...t, amount: Number(t.amount) }));
      existingTxns.forEach(t => { if (t.hash) existingHashes.add(t.hash); });
    }

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      const cat = categorized[i];
      const vendor = extractVendor(tx.description) || cat.vendor;

      // 1. Exact Hash Match
      if (existingHashes.has(tx.hash)) {
        skipped++;
        continue;
      }

      // 2. Fuzzy Match (same amount/type within ±3 days)
      const possibleDups = existingTxns.filter(e => 
        Number(e.amount) === tx.amount && 
        e.type === tx.type &&
        Math.abs(e.date.getTime() - tx.date.getTime()) <= 3 * 24 * 60 * 60 * 1000
      );

      if (possibleDups.length > 0) {
        conflicts.push({
          incoming: { ...tx, category: cat.category, vendor },
          existing: possibleDups[0]
        });
        skipped++;
        continue;
      }

      try {
        await prisma.bankTransaction.create({
          data: {
            date: tx.date,
            description: tx.description,
            amount: tx.amount,
            type: tx.type,
            balance: tx.balance,
            reference: tx.reference,
            category: cat.category,
            vendor: vendor,
            confidence: cat.confidence,
            hash: tx.hash,
            source: "csv",
            bankAccountId: accountId!,
            userId,
            importBatchId: batch.id,
          },
        });

        imported++;

        // Skip trivial amounts (< ₹1) and internal transfers for expense/revenue creation
        const isInternal = /TRF TO FD|FD clos|Closure Proceed|REV\s|REV\n|AC VERIFY|bankAccountVeri/i.test(tx.description);
        const isTrivial = tx.amount < 1;

        if (!isTrivial && !isInternal) {
          if (tx.type === "debit") {
            // Auto-create Expense from debit transaction
            try {
              await prisma.expense.create({
                data: {
                  description: tx.description,
                  amount: tx.amount,
                  date: tx.date,
                  vendor: vendor || undefined,
                  notes: `[${cat.category || "Other"}] Auto-imported from bank statement. Ref: ${tx.reference || tx.hash}`,
                  source: "bank_import",
                  userId,
                  organizationId: user?.organizationId,
                },
              });
              expensesCreated++;
            } catch (e) {
              // Non-critical — log and continue
              log.warn("Failed to create expense for bank txn", { module: "bank", action: "import", meta: { hash: tx.hash }, error: toLogError(e) });
            }
          } else if (tx.type === "credit") {
            // Auto-create Revenue from credit transaction
            try {
              await prisma.revenue.create({
                data: {
                  amount: tx.amount,
                  month: tx.date,
                  type: cat.category === "Capital" ? "capital" : "recurring",
                  source: vendor || tx.description.substring(0, 100),
                  notes: `Auto-imported from bank statement. Ref: ${tx.reference || tx.hash}`,
                  userId,
                  organizationId: user?.organizationId,
                },
              });
              revenueCreated++;
            } catch (e) {
              log.warn("Failed to create revenue for bank txn", { module: "bank", action: "import", meta: { hash: tx.hash }, error: toLogError(e) });
            }
          }
        }
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err.code === "P2002") {
          // Unique constraint failed on hash (just in case)
          skipped++;
        } else {
          log.error("Failed to insert transaction", { module: "bank", action: "import", meta: { hash: tx.hash }, error: toLogError(err) });
        }
      }
    }

    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "completed" },
    });

    logAudit({ userId, action: "import", resource: "bank_transaction", resourceId: batch.id, details: { fileName: file.name, imported, skipped, conflictsFound: conflicts.length } });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      totalRows: transactions.length,
      imported,
      skipped,
      conflicts,
      expensesCreated,
      revenueCreated,
      bankAccountId: accountId,
    });
  } catch (error: unknown) {
    log.error("Bank CSV Import Error", { module: "bank", action: "import", error: toLogError(error) });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to import CSV" }, { status: 500 });
  }
}
