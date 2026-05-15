import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { parseReceiptWithAI } from "@/lib/document-intelligence";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const ReceiptUploadSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().max(5 * 1024 * 1024, "File exceeds 5MB limit"),
});

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 10, prefix: "receipts-upload" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const metaParsed = ReceiptUploadSchema.safeParse({
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      sizeBytes: file.size,
    });
    if (!metaParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: metaParsed.error.issues }, { status: 400 });
    }

    // Since we're using base64 for Gemini vision inline data and Prisma storage:
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");
    const mimeType = file.type || "image/jpeg";

    if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
      return NextResponse.json({ error: "Unsupported file type. Upload images or PDFs." }, { status: 400 });
    }

    // Create tracking record in DB
    const receipt = await prisma.receipt.create({
      data: {
        fileName: file.name,
        mimeType,
        imageData: base64Data, // In MVP we store it directly to DB
        status: "processing",
        userId,
      },
    });

    // Run AI OCR parser
    const parsedData = await parseReceiptWithAI(base64Data, mimeType);

    if (parsedData) {
      // Valid Parse
      const updateData = {
        status: "processed",
        confidence: parsedData.confidence || 0.85,
        extractedData: JSON.stringify(parsedData), // Save the raw json as well
        extractedVendor: parsedData.vendorName || null,
        extractedAmount: parsedData.amount !== null ? parsedData.amount : null,
        extractedGst: parsedData.gstNumber,
        extractedCategory: parsedData.category,
        extractedDate: parsedData.date ? new Date(parsedData.date) : null,
      };

      await prisma.receipt.update({
        where: { id: receipt.id },
        data: updateData,
      });

      return NextResponse.json({
        success: true,
        receiptId: receipt.id,
        parsedData,
      });
    } else {
      // Failed Parse
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: { status: "failed" },
      });
      return NextResponse.json({ error: "Failed to extract data using AI" }, { status: 500 });
    }
  } catch (error: unknown) {
    log.error("Receipt upload error", { module: "receipts", action: "upload", error: toLogError(error) });
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
