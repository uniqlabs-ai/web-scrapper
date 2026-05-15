import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireTenant, TenantError } from "@/lib/tenant";
import { parseCSV } from "@/lib/bank-import";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";
import {
  ImportTarget,
  autoDetectMapping,
  validateAndPreview,
  transformForInsert,
  TARGET_COLUMNS,
} from "@/lib/csv-importer";

/**
 * POST /api/import/csv — Multi-step CSV import
 *
 * Step 1 (action=detect): Upload CSV, auto-detect columns → returns headers + mapping
 * Step 2 (action=preview): Upload CSV + mapping → returns preview rows with validation
 * Step 3 (action=import): Upload CSV + mapping → bulk inserts into target table
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 10, prefix: "import-csv" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const action = formData.get("action") as string;
    const target = formData.get("target") as ImportTarget;
    const mappingStr = formData.get("mapping") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    const CsvImportParamsSchema = z.object({
      action: z.enum(["detect", "preview", "import"]),
      target: z.enum(["expenses", "revenue", "invoices"]),
    });

    const paramsParsed = CsvImportParamsSchema.safeParse({ action, target });
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: paramsParsed.error.issues }, { status: 400 });
    }

    const csvText = await file.text();
    const { headers, rows } = parseCSV(csvText);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "CSV is empty or has no data rows" },
        { status: 400 }
      );
    }

    // ── Step 1: Detect columns ─────────────────────────────
    if (action === "detect") {
      const mapping = autoDetectMapping(headers, target);
      const columns = TARGET_COLUMNS[target];
      return NextResponse.json({
        headers,
        totalRows: rows.length,
        mapping,
        targetColumns: columns,
      });
    }

    // ── Step 2: Preview with validation ────────────────────
    const mapping = mappingStr ? JSON.parse(mappingStr) : autoDetectMapping(headers, target);

    if (action === "preview") {
      const result = validateAndPreview(csvText, target, mapping);
      return NextResponse.json({
        preview: result.preview,
        validCount: result.validCount,
        errorCount: result.errorCount,
        totalRows: rows.length,
      });
    }

    // ── Step 3: Import ─────────────────────────────────────
    if (action === "import") {
      const result = validateAndPreview(csvText, target, mapping);

      // Get user's org
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
      });

      const records = transformForInsert(
        result.preview,
        target,
        userId,
        user?.organizationId
      );

      // Track batch
      const batch = await prisma.importBatch.create({
        data: {
          type: `${target}_csv`,
          fileName: file.name,
          rowCount: records.length,
          status: "processing",
          columnMapping: JSON.stringify(mapping),
          userId,
        },
      });

      let imported = 0;
      let failed = 0;

      // Bulk insert per target
      try {
        switch (target) {
          case "expenses": {
            const result = await prisma.expense.createMany({
              data: records as Prisma.ExpenseCreateManyInput[],
              skipDuplicates: true,
            });
            imported = result.count;
            break;
          }
          case "revenue": {
            const result = await prisma.revenue.createMany({
              data: records as Prisma.RevenueCreateManyInput[],
              skipDuplicates: true,
            });
            imported = result.count;
            break;
          }
          case "invoices": {
            const result = await prisma.invoice.createMany({
              data: records as Prisma.InvoiceCreateManyInput[],
              skipDuplicates: true,
            });
            imported = result.count;
            break;
          }
        }
      } catch (err) {
        log.error("Bulk insert error", { module: "import", action: "csv", error: toLogError(err) });
        failed = records.length;
      }

      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: failed > 0 ? "failed" : "completed",
          rowCount: imported,
          errorMessage: failed > 0 ? `${failed} records failed to import` : null,
        },
      });

      return NextResponse.json({
        success: true,
        batchId: batch.id,
        imported,
        failed,
        totalValid: result.validCount,
        totalErrors: result.errorCount,
        target,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Must be: detect, preview, or import" },
      { status: 400 }
    );
  } catch (error) {
    log.error("CSV import error", { module: "import", action: "csv", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to process import" },
      { status: 500 }
    );
  }
}
