import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { categorizeTransaction, EXPENSE_CATEGORIES } from "@/lib/transaction-categorizer";
import { classifyPdf as classifyPdfLib, csvSplit as csvSplitLib, parseDate as parseDateLib, type DocType } from "@/lib/smart-import";
import { parseCSV, detectColumnMapping, normalizeTransactions, extractVendor, findOrCreateBankAccount, checkExistingHashes } from "@/lib/bank-import";
import { batchCategorize } from "@/lib/transaction-categorizer";
import { execSync } from "child_process";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import fs from "fs";
import os from "os";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const SmartImportFileSchema = z.object({
  fileName: z.string().min(1).max(500),
  sizeBytes: z.number().max(50 * 1024 * 1024, "File exceeds 50MB limit"),
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");


/**
 * Classify a PDF by extracting first-page text and checking markers.
 * Delegates to the tested lib/smart-import module.
 */
const classifyPdf = classifyPdfLib;

/**
 * Extract first page text from a PDF using PyPDF2.
 */
function extractFirstPage(tmpPath: string): string {
  try {
    const script = `
import PyPDF2, sys
with open(sys.argv[1], 'rb') as f:
    reader = PyPDF2.PdfReader(f)
    if reader.pages:
        print(reader.pages[0].extract_text() or '')
`;
    return execSync(`python3 -c "${script.replace(/"/g, '\\"')}" "${tmpPath}"`, {
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * CSV split — delegates to lib/smart-import.
 */
const csvSplit = csvSplitLib;

/**
 * Date parser — delegates to lib/smart-import.
 */
const parseDate = parseDateLib;


/**
 * POST /api/import/smart — Auto-detect document type and route to correct parser
 */
export async function POST(request: Request) {
  try {
    const limited = rateLimit(request as NextRequest, { windowSec: 60, max: 5, prefix: "import-smart" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileParsed = SmartImportFileSchema.safeParse({ fileName: file.name, sizeBytes: file.size });
    if (!fileParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: fileParsed.error.issues }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();

    // CSV files → auto-detect as bank statement if columns match
    if (fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);

      if (rows.length === 0) {
        return NextResponse.json({ error: "No data found in CSV" }, { status: 400 });
      }

      // Auto-detect column mapping
      const mapping = detectColumnMapping(headers);

      // If we can detect date + description + amount columns, treat as bank statement
      if (mapping.date && mapping.description && (mapping.amount || mapping.debit || mapping.credit)) {
        const safeMapping = mapping as { date: string; description: string } & typeof mapping;
        const transactions = normalizeTransactions(rows, safeMapping);

        if (transactions.length === 0) {
          return NextResponse.json({ error: "No valid transactions found" }, { status: 400 });
        }

        // Find or create bank account using shared helper (prevents duplicates across import paths)
        const bankAccountId = await findOrCreateBankAccount(prisma, userId, {
          organizationId: user?.organizationId || undefined,
        });

        // Batch categorize all transactions
        const categorized = batchCategorize(
          transactions.map((t) => ({ description: t.description, amount: t.amount, type: t.type }))
        );

        const userOrg = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
        const categoryCache: Record<string, string> = {};
        let imported = 0;
        let skipped = 0;

        // Pre-load existing hashes for dedup (Issue #3)
        const existingHashes = await checkExistingHashes(prisma, userId, bankAccountId, transactions);

        for (let i = 0; i < transactions.length; i++) {
          const tx = transactions[i];
          const cat = categorized[i];
          const vendor = extractVendor(tx.description) || cat.vendor;

          // Skip trivial amounts and internal transfers
          const isInternal = /TRF TO FD|FD clos|Closure Proceed|REV\s|AC VERIFY/i.test(tx.description);
          if (tx.amount < 1 || isInternal) continue;

          // Dedup: skip if hash already exists in DB
          if (existingHashes.has(tx.hash)) {
            skipped++;
            continue;
          }

          try {
            // Create bank transaction
            const bt = await prisma.bankTransaction.create({
              data: {
                userId,
                bankAccountId,
                date: tx.date,
                description: tx.description,
                amount: tx.amount,
                type: tx.type,
                category: tx.type === "credit" && cat.confidence <= 0.1 ? "Income / Revenue" : cat.category,
                vendor: vendor || undefined,
                confidence: cat.confidence,
                balance: tx.balance,
                reference: tx.reference || undefined,
                hash: tx.hash,
                source: "csv",
              },
            });

            // Track hash so subsequent rows in this batch also dedup
            existingHashes.add(tx.hash);

            // Auto-create Expense or Revenue for dashboard population
            if (tx.type === "debit") {
              if (!categoryCache[cat.category]) {
                const catMeta = EXPENSE_CATEGORIES.find((c) => c.name === cat.category);
                const catRecord = await prisma.expenseCategory.upsert({
                  where: { userId_name: { userId, name: cat.category } },
                  create: { userId, name: cat.category, color: catMeta?.color || "#9CA3AF", icon: catMeta?.icon || "📦", organizationId: userOrg?.organizationId || undefined },
                  update: {},
                });
                categoryCache[cat.category] = catRecord.id;
              }
              const expense = await prisma.expense.create({
                data: {
                  userId,
                  organizationId: userOrg?.organizationId || undefined,
                  description: tx.description,
                  amount: tx.amount,
                  vendor: vendor || undefined,
                  categoryId: categoryCache[cat.category],
                  date: tx.date,
                  notes: `Auto-imported from ${file.name} | ${cat.category} (${Math.round(cat.confidence * 100)}%) | Ref: ${tx.reference || tx.hash}`,
                  source: "bank_import",
                  sourceId: bt.id,
                },
              });
              await prisma.bankTransaction.update({ where: { id: bt.id }, data: { matchedExpenseId: expense.id } });
            } else {
              const revenue = await prisma.revenue.create({
                data: {
                  userId,
                  organizationId: userOrg?.organizationId || undefined,
                  source: tx.description,
                  amount: tx.amount,
                  category: cat.category === "Misc" && cat.confidence <= 0.1 ? "Income / Revenue" : cat.category,
                  type: "one-time",
                  month: tx.date,
                  notes: `Auto-imported from ${file.name} | ${cat.category} (${Math.round(cat.confidence * 100)}%) | Ref: ${tx.reference || tx.hash}`,
                  sourceId: bt.id,
                },
              });
              await prisma.bankTransaction.update({ where: { id: bt.id }, data: { matchedInvoiceId: revenue.id } });
            }
            imported++;
          } catch (e: unknown) {
            // Skip duplicates (P2002) silently, log others
            const err = e as { code?: string };
            if (err.code === "P2002") {
              skipped++;
            } else {
              log.warn("Skipped CSV transaction", { module: "import", action: "smart", meta: { error: e instanceof Error ? e.message : String(e) } });
            }
          }
        }

        // Update bank account balance
        if (imported > 0) {
          const latestTxn = await prisma.bankTransaction.findFirst({
            where: { bankAccountId },
            orderBy: { date: "desc" },
            select: { balance: true },
          });
          if (latestTxn?.balance != null) {
            await prisma.bankAccount.update({
              where: { id: bankAccountId },
              data: { currentBalance: Number(latestTxn.balance) },
            });
          }
        }

        // Create import batch
        await prisma.importBatch.create({
          data: { type: "bank_csv", fileName: file.name, rowCount: imported, status: "completed", columnMapping: JSON.stringify(mapping), userId },
        });

        return NextResponse.json({
          success: true,
          detectedType: "bank_statement",
          label: "Bank Statement (CSV)",
          summary: imported > 0
            ? `${imported} transactions imported from ${file.name}${skipped > 0 ? ` (${skipped} duplicates skipped)` : ""}`
            : `No new transactions — ${skipped} duplicates skipped`,
          details: { totalTransactions: transactions.length, imported, skipped, mapping },
          imported,
          skipped,
          bankAccountId,
        });
      }

      // If columns don't match bank statement pattern, ask for manual target
      return NextResponse.json({
        detectedType: "csv",
        message: "CSV columns don't match a bank statement. Please use the CSV import tool.",
        requiresManualTarget: true,
        headers,
      });
    }

    if (!fileName.endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF and CSV files are supported" }, { status: 400 });
    }

    // Write PDF to temp
    const bytes = await file.arrayBuffer();
    const tmpPath = path.join(os.tmpdir(), `smart_import_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, Buffer.from(bytes));

    // Extract first page and classify
    const firstPage = extractFirstPage(tmpPath);
    let docType = classifyPdf(firstPage);

    // If unknown, use Gemini as a fallback classifier
    if (docType === "unknown" && process.env.GEMINI_API_KEY) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const classifyResult = await model.generateContent([
          `Classify this document into EXACTLY ONE of these categories. Return ONLY the category name, nothing else:
- invoice
- bank_statement
- financial_statement

The document's first page text:
${firstPage.substring(0, 2000)}`,
        ]);
        const classification = (classifyResult.response?.text() || "").trim().toLowerCase();
        if (["invoice", "bank_statement", "financial_statement"].includes(classification)) {
          docType = classification as DocType;
        }
      } catch (e) {
        // Continue with unknown
      }
    }

    // Route to the correct parser
    let result;

    if (docType === "invoice") {
      // ──── INVOICE PARSER ────
      const scriptPath = path.join(process.cwd(), "scripts", "extract_invoice.py");
      try {
        const output = execSync(`python3 "${scriptPath}" "${tmpPath}"`, {
          encoding: "utf-8",
          timeout: 30000,
        });
        const parsed = JSON.parse(output.trim());

        if (parsed.error) {
          result = { success: false, error: parsed.error, detectedType: docType };
        } else {
          const lineItems = (parsed.lineItems || []).filter(
            (item: { amount: number }) => item.amount > 0
          );

          // Upsert client
          let clientId: string | null = null;
          const clientName = parsed.billedTo?.name;
          if (clientName && clientName.length > 2) {
            const existing = await prisma.client.findFirst({
              where: { userId, name: { contains: clientName, mode: "insensitive" } },
            });
            if (existing) {
              clientId = existing.id;
            } else {
              const newClient = await prisma.client.create({
                data: {
                  userId,
                  organizationId: user?.organizationId,
                  name: clientName,
                  email: "",
                  address: parsed.billedTo?.address || "",
                },
              });
              clientId = newClient.id;
            }
          }

          const invoiceDate = parsed.date ? new Date(parsed.date) : new Date();
          const dueDate = parsed.dueDate ? new Date(parsed.dueDate) : new Date(invoiceDate.getTime() + 30 * 86400000);

          // Determine invoice number
          let invoiceNumber = parsed.reference || parsed.invoiceNumber || `INV-${Date.now()}`;
          const forceImport = formData.get("forceImport") === "true";

          // Check for duplicate invoice
          const existingInvoice = await prisma.invoice.findFirst({
            where: { userId, invoiceNumber },
            include: { client: true },
          });

          if (existingInvoice && !forceImport) {
            // Return duplicate info — don't create
            result = {
              success: false,
              duplicate: true,
              detectedType: docType,
              label: "Invoice",
              summary: `Duplicate invoice: ${invoiceNumber} already exists`,
              existingInvoice: {
                id: existingInvoice.id,
                invoiceNumber: existingInvoice.invoiceNumber,
                client: existingInvoice.client?.name || null,
                total: Number(existingInvoice.total),
                currency: existingInvoice.currency,
                issueDate: existingInvoice.issueDate,
                status: existingInvoice.status,
              },
              parsed: {
                invoiceNumber,
                client: clientName || null,
                total: Number(parsed.total),
                currency: parsed.currency || "INR",
              },
              error: `Invoice ${invoiceNumber} already exists (${existingInvoice.client?.name || "Unknown"}, ${existingInvoice.currency} ${Number(existingInvoice.total).toLocaleString()})`,
            };
          } else {
            // If forcing import on duplicate, suffix the invoice number
            if (existingInvoice && forceImport) {
              const count = await prisma.invoice.count({ where: { userId, invoiceNumber: { startsWith: invoiceNumber } } });
              invoiceNumber = `${invoiceNumber}-R${count}`;
            }

          const invoice = await prisma.invoice.create({
            data: {
              userId,
              organizationId: user?.organizationId || undefined,
              invoiceNumber,
              status: "sent",
              issueDate: invoiceDate,
              dueDate,
              subtotal: parsed.subtotal || parsed.total || 0,
              taxTotal: parsed.tax || 0,
              total: parsed.total || 0,
              currency: parsed.currency || "INR",
              gstNumber: parsed.gstin || undefined,
              notes: `Auto-imported from ${file.name} | Format: ${parsed.format} | PO: ${parsed.purchaseOrder || "N/A"}`,
              clientId,
              lineItems: {
                create: lineItems.map((item: { description: string; qty: number; rate: number; amount: number }) => ({
                  description: item.description,
                  quantity: item.qty || 1,
                  unitPrice: item.rate || item.amount,
                  amount: item.amount,
                  total: item.amount,
                  gstRate: 0, cgst: 0, sgst: 0, igst: 0,
                })),
              },
            },
            include: { lineItems: true, client: true },
          });

          // Smart revenue match
          let revenueMatch = null;
          const totalAmount = Number(parsed.total);
          const searchStart = new Date(invoiceDate);
          searchStart.setDate(searchStart.getDate() - 30);
          const searchEnd = new Date(invoiceDate);
          searchEnd.setDate(searchEnd.getDate() + 30);

          const candidateRevenues = await prisma.revenue.findMany({
      take: 500,
            where: { userId, month: { gte: searchStart, lte: searchEnd } },
          });

          for (const rev of candidateRevenues) {
            const revAmount = Number(rev.amount);
            const amountDiff = Math.abs(revAmount - totalAmount) / Math.max(totalAmount, 1);
            if (amountDiff <= 0.05) {
              await prisma.revenue.update({
                where: { id: rev.id },
                data: { sourceId: invoice.id, source: "invoice_matched" },
              });
              revenueMatch = { revenueId: rev.id, confidence: amountDiff < 0.01 ? 0.95 : 0.85 };
              break;
            }
          }

          result = {
            success: true,
            detectedType: docType,
            label: "Invoice",
            summary: `Invoice ${invoice.invoiceNumber} — ${parsed.currency} ${Number(parsed.total).toLocaleString()}`,
            details: {
              invoiceNumber: invoice.invoiceNumber,
              client: invoice.client?.name || null,
              total: Number(invoice.total),
              currency: invoice.currency,
              lineItems: lineItems.length,
              revenueMatch,
            },
            imported: lineItems.length,
          };
          } // end else (no duplicate)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        result = { success: false, error: `Invoice parse failed: ${msg}`, detectedType: docType };
      }

    } else if (docType === "bank_statement") {
      // ──── BANK STATEMENT PARSER ────
      const scriptPath = path.join(process.cwd(), "scripts", "extract_pdf_statement.py");
      const tmpCsvPath = tmpPath.replace(".pdf", ".csv");
      try {
        const output = execSync(`python3 "${scriptPath}" "${tmpPath}" "${tmpCsvPath}"`, {
          encoding: "utf-8",
          timeout: 120000,
        });
        const meta = JSON.parse(output.trim());

        if (!meta.success) {
          throw new Error(meta.error || "Parse failed");
        } else {
          // Find or create bank account using shared helper (prevents duplicates across import paths)
          const bankName = meta.bank_name || "Imported Bank";
          const accountNumber = meta.account_number || "";
          const bankAccountId = await findOrCreateBankAccount(prisma, userId, {
            bankName,
            accountNumber: accountNumber || undefined,
            organizationId: user?.organizationId || undefined,
          });

          // Read CSV and parse by header names
          const csvContent = fs.readFileSync(tmpCsvPath, "utf-8");
          const csvLines = csvContent.split("\n").filter((l) => l.trim());
          const headers = csvSplit(csvLines[0]).map((h) => h.toLowerCase());
          const dateIdx = headers.findIndex((h) => h === "date");
          const descIdx = headers.findIndex((h) => h.includes("description") || h.includes("particulars") || h.includes("remarks"));
          const debitIdx = headers.findIndex((h) => h === "debit" || h.includes("withdrawal") || h === "dr" || (h.includes("dr") && !h.includes("description") && h !== "cr/dr"));
          const creditIdx = headers.findIndex((h) => h === "credit" || h.includes("deposit") || (h === "cr") || (h.includes("credit") && !h.includes("description")));
          // If creditIdx matched description by mistake or wasn't found, search more carefully
          const creditIdxFixed = (creditIdx < 0 || creditIdx === descIdx)
            ? headers.findIndex((h, idx) => idx !== descIdx && idx !== dateIdx && idx !== debitIdx && (h.includes("credit") || h.includes("deposit") || h === "cr" || h.includes("(cr)")))
            : creditIdx;
          const debitIdxFixed = (debitIdx < 0 || debitIdx === descIdx)
            ? headers.findIndex((h, idx) => idx !== descIdx && idx !== dateIdx && (h.includes("debit") || h.includes("withdrawal") || h === "dr" || h.includes("(dr)")))
            : debitIdx;
          const balanceIdx = headers.findIndex((h) => h.includes("balance"));
          const refIdx = headers.findIndex((h) => h.includes("reference") || (h.includes("ref") && !h.includes("description")));



          let imported = 0;
          const categoryCache: Record<string, string> = {}; // category name → ExpenseCategory ID
          for (let i = 1; i < csvLines.length; i++) {
            const cols = csvSplit(csvLines[i]);
            const dateStr = (dateIdx >= 0 ? cols[dateIdx] : "") || "";
            const description = (descIdx >= 0 ? cols[descIdx] : "") || "";
            const debitStr = (debitIdxFixed >= 0 ? cols[debitIdxFixed] : "") || "";
            const creditStr = (creditIdxFixed >= 0 ? cols[creditIdxFixed] : "") || "";
            const balanceStr = (balanceIdx >= 0 ? cols[balanceIdx] : "") || "";
            const reference = (refIdx >= 0 ? cols[refIdx] : "") || "";

            const debit = parseFloat(debitStr.replace(/,/g, "")) || 0;
            const credit = parseFloat(creditStr.replace(/,/g, "")) || 0;
            const amount = debit > 0 ? debit : credit;

            if (amount === 0) continue;

            const txnType = debit > 0 ? "debit" : "credit";
            const balance = parseFloat(balanceStr.replace(/,/g, "")) || 0;
            const txnDate = parseDate(dateStr);

            // Auto-categorize from description
            const catResult = categorizeTransaction(description, txnType);

            // Create bank transaction first
            let bt;
            try {
              bt = await prisma.bankTransaction.create({
                data: {
                  userId,
                  bankAccountId,
                  date: txnDate,
                  description: description || "Bank transaction",
                  amount,
                  type: txnType,
                  category: txnType === "credit" && catResult.confidence <= 0.1
                    ? "Income / Revenue"
                    : catResult.category,
                  vendor: catResult.vendor || undefined,
                  confidence: catResult.confidence,
                  balance,
                  reference: reference || undefined,
                  isReconciled: true, // Auto-reconciled: bank statement is source of truth
                },
              });
            } catch (e: unknown) {
              log.warn("Skipped duplicate bank transaction", { module: "import", action: "smart", meta: { error: e instanceof Error ? e.message : String(e) } });
              continue;
            }

            // Create Expense or Revenue entries so dashboards populate
            // Then link back to BankTransaction for reconciliation
            try {
              if (txnType === "debit") {
                // Upsert ExpenseCategory for the auto-detected category
                if (!categoryCache[catResult.category]) {
                  const catMeta = EXPENSE_CATEGORIES.find(c => c.name === catResult.category);
                  const cat = await prisma.expenseCategory.upsert({
                    where: { userId_name: { userId, name: catResult.category } },
                    create: {
                      userId,
                      name: catResult.category,
                      color: catMeta?.color || "#9CA3AF",
                      icon: catMeta?.icon || "📦",
                      organizationId: user?.organizationId || undefined,
                    },
                    update: {},
                  });
                  categoryCache[catResult.category] = cat.id;
                }

                const expense = await prisma.expense.create({
                  data: {
                    userId,
                    organizationId: user?.organizationId || undefined,
                    description: description || "Bank debit",
                    amount,
                    vendor: catResult.vendor || undefined,
                    categoryId: categoryCache[catResult.category],
                    date: txnDate,
                    notes: `Auto-imported from bank statement | Category: ${catResult.category} (${Math.round(catResult.confidence * 100)}%) | Ref: ${reference || "N/A"}`,
                    source: "bank_import",
                    sourceId: bt.id,
                  },
                });
                // Link bank transaction → expense
                await prisma.bankTransaction.update({
                  where: { id: bt.id },
                  data: { matchedExpenseId: expense.id },
                });
              } else {
                const revenue = await prisma.revenue.create({
                  data: {
                    userId,
                    organizationId: user?.organizationId || undefined,
                    source: description || "Bank credit",
                    amount,
                    category: catResult.category === "Misc" && catResult.confidence <= 0.1
                      ? "Income / Revenue"
                      : catResult.category,
                    type: "one-time",
                    month: txnDate,
                    notes: `Auto-imported from bank statement | Category: ${catResult.category} (${Math.round(catResult.confidence * 100)}%) | Ref: ${reference || "N/A"}`,
                    sourceId: bt.id,
                  },
                });
                // Link bank transaction → invoice match (via revenue sourceId)
                await prisma.bankTransaction.update({
                  where: { id: bt.id },
                  data: { matchedInvoiceId: revenue.id },
                });
              }
            } catch (dashErr) {
              log.error("Failed to create dashboard entry for bank txn", { module: "import", action: "smart", meta: { txnId: bt.id, type: txnType }, error: toLogError(dashErr) });
            }

            imported++;
          }

          // Auto-update bank account balance from latest imported transaction
          if (imported > 0) {
            const latestTxn = await prisma.bankTransaction.findFirst({
              where: { bankAccountId },
              orderBy: { date: "desc" },
              select: { balance: true },
            });
            if (latestTxn?.balance != null) {
              await prisma.bankAccount.update({
                where: { id: bankAccountId },
                data: { currentBalance: Number(latestTxn.balance) },
              });
            }
          }

          // Cleanup CSV
          try { fs.unlinkSync(tmpCsvPath); } catch (e: unknown) {
            log.warn("Failed to cleanup temp CSV", { module: "import", action: "smart", meta: { error: e instanceof Error ? e.message : String(e) } });
          }

          result = {
            success: true,
            detectedType: docType,
            label: "Bank Statement",
            summary: `${imported} transactions imported from ${meta.bank_name || "bank"} (${meta.period_from || "?"} to ${meta.period_to || "?"})`,
            details: {
              bankName: meta.bank_name || null,
              accountNumber: meta.account_number || null,
              period: `${meta.period_from || ""} to ${meta.period_to || ""}`,
              totalTransactions: meta.transaction_count || imported,
              totalDebit: meta.total_debit || 0,
              totalCredit: meta.total_credit || 0,
            },
            imported,
          };
        }
      } catch (err: unknown) {
        try { fs.unlinkSync(tmpCsvPath); } catch (e: unknown) {
          log.warn("Failed to cleanup temp CSV", { module: "import", action: "smart", meta: { error: e instanceof Error ? e.message : String(e) } });
        }
        const msg = err instanceof Error ? err.message : "Unknown error";
        result = { success: false, error: `Bank statement parse failed: ${msg}`, detectedType: docType };
      }

    } else {
      // ──── FINANCIAL STATEMENT / UNKNOWN → GEMINI AI ────
      if (!process.env.GEMINI_API_KEY) {
        result = { success: false, error: "GEMINI_API_KEY not configured", detectedType: docType };
      } else {
        const base64 = Buffer.from(bytes).toString("base64");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `You are an expert Indian chartered accountant. Extract EVERY financial line item from this document.
Return JSON: { "documentType": "...", "companyName": "...", "period": "...", "lineItems": [{ "date": "YYYY-MM-DD", "description": "...", "category": "...", "amount": number, "type": "expense|revenue|asset|liability" }] }
Return ONLY valid JSON.`;

        const aiResult = await model.generateContent([
          prompt,
          { inlineData: { mimeType: "application/pdf", data: base64 } },
        ]);

        let jsonStr = (aiResult.response?.text() || "").trim();
        if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          result = { success: false, error: "Failed to parse AI response", detectedType: docType };
          try { fs.unlinkSync(tmpPath); } catch (e: unknown) { log.warn("Cleanup error", { module: "import", action: "smart", error: toLogError(e) }); }
          return NextResponse.json(result, { status: 422 });
        }

        // Import line items
        let imported = 0;
        const items = parsed.lineItems || [];

        for (const item of items) {
          const amount = Math.abs(Number(item.amount) || 0);
          if (amount === 0) continue;

          const itemDate = item.date ? new Date(item.date) : new Date();
          const isExpense = ["debit", "expense"].includes(item.type);
          const isRevenue = ["credit", "revenue"].includes(item.type);

          try {
            if (isExpense) {
              await prisma.expense.create({
                data: {
                  userId,
                  organizationId: user?.organizationId,
                  description: item.description || "Imported item",
                  amount,
                  date: itemDate,
                  notes: `Imported from ${file.name} | Category: ${item.category || "Uncategorized"}`,
                },
              });
              imported++;
            } else if (isRevenue) {
              await prisma.revenue.create({
                data: {
                  userId,
                  organizationId: user?.organizationId,
                  source: item.description || "Imported revenue",
                  amount,
                  month: itemDate,
                  notes: `Imported from ${file.name} | Category: ${item.category || "Other"}`,
                },
              });
              imported++;
            }
          } catch (e: unknown) {
            log.warn("Skipped financial item", { module: "import", action: "smart", meta: { error: e instanceof Error ? e.message : String(e) } });
          }
        }

        result = {
          success: true,
          detectedType: "financial_statement",
          label: parsed.documentType || "Financial Statement",
          summary: `${imported} items imported from ${parsed.companyName || file.name}${parsed.period ? ` (${parsed.period})` : ""}`,
          details: {
            companyName: parsed.companyName,
            period: parsed.period,
            totalItems: items.length,
          },
          imported,
        };
      }
    }

    // Cleanup temp file
    try { fs.unlinkSync(tmpPath); } catch (e: unknown) {
      log.warn("Failed to cleanup temp file", { module: "import", action: "smart", meta: { error: e instanceof Error ? e.message : String(e) } });
    }

    // Create import batch
    if (result?.success) {
      await prisma.importBatch.create({
        data: {
          type: result.detectedType || "auto",
          fileName: file.name,
          rowCount: result.imported || 0,
          status: "completed",
          columnMapping: JSON.stringify({ detectedType: result.detectedType, summary: result.summary }),
          userId,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    log.error("Smart import error", { module: "import", action: "smart", error: toLogError(error) });
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
