import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const ReceiptFileSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  sizeBytes: z.number().max(10 * 1024 * 1024, "File too large. Maximum 10MB allowed."),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;

    const expense = await prisma.expense.findFirst({
      where: { id, userId, organizationId },
    });

    if (!expense) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("receipt") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No receipt file provided" },
        { status: 400 }
      );
    }

    const fileParsed = ReceiptFileSchema.safeParse({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (!fileParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: fileParsed.error.issues }, { status: 400 });
    }

    // Store receipt as base64 data URI for now (in production, upload to Supabase Storage)
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUri = `data:${file.type};base64,${base64}`;

    const updated = await prisma.expense.update({
      where: { id },
      data: { receipt: dataUri },
      include: { category: true },
    });

    return NextResponse.json({
      expense: updated,
      message: "Receipt uploaded successfully",
    });
  } catch (error) {
    log.error("Upload receipt error", { module: "expenses", action: "receipt", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to upload receipt" },
      { status: 500 }
    );
  }
}
