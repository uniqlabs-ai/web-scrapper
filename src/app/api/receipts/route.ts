import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const ConvertReceiptSchema = z.object({
  receiptId: z.string().min(1, "receiptId is required"),
  vendorName: z.string().min(1, "vendorName is required").max(200),
  amount: z.coerce.number().positive("Amount must be positive").max(999_999_999),
  date: z.string().refine(v => !isNaN(Date.parse(v)), { message: "Invalid date" }),
  category: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  gstNumber: z.string().max(20).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const receipts = await prisma.receipt.findMany({
      take: 500,
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { expense: true },
    });
    
    // Convert Decimal to Number for frontend safely, and avoid sending raw base64 data to UI
    const payload = receipts.map(r => ({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      status: r.status,
      createdAt: r.createdAt,
      expenseId: r.expenseId,
      expense: r.expense,
      extractedAmount: r.extractedAmount ? Number(r.extractedAmount) : null,
      extractedVendor: r.extractedVendor,
      extractedDate: r.extractedDate,
      extractedGst: r.extractedGst,
      extractedCategory: r.extractedCategory,
      confidence: r.confidence ? Number(r.confidence) : null,
      extractedData: r.extractedData ? JSON.parse(r.extractedData) : null
    }));

    return NextResponse.json({ receipts: payload });
  } catch (error) {
    log.error("GET Receipts error", { module: "receipts", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to fetch receipts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "receipts" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = ConvertReceiptSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { receiptId, vendorName, amount, date, category, notes, gstNumber } = parsed.data;

    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId, userId }
    });

    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    if (receipt.expenseId) {
      return NextResponse.json({ error: "Receipt has already been converted to an Expense" }, { status: 400 });
    }

    // Lookup User Org for linkage
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
    const orgId = user?.organizationId || undefined;

    // Handle Vendor
    let vendorId: string | undefined = undefined;
    let existingVendor = await prisma.vendor.findFirst({
      where: { userId, name: vendorName }
    });

    if (!existingVendor) {
      existingVendor = await prisma.vendor.create({
        data: {
          userId,
          organizationId: orgId,
          name: vendorName,
          gstNumber: gstNumber || undefined
        }
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vendorId = existingVendor.id;

    // Handle Category
    let categoryId: string | undefined = undefined;
    if (category) {
       let existingCat = await prisma.expenseCategory.findFirst({
         where: { userId, name: category }
       });
       if (!existingCat) {
          existingCat = await prisma.expenseCategory.create({
             data: {
               userId,
               organizationId: orgId,
               name: category,
               color: "#94A3B8"
             }
          });
       }
       categoryId = existingCat.id;
    }

    // Create Expense
    const expense = await prisma.expense.create({
      data: {
        userId,
        organizationId: orgId,
        amount: Number(amount),
        date: new Date(date),
        description: `${vendorName} - Auto Expense`,
        notes: notes || "Generated via Document Intelligence",
        vendor: vendorName,
        vendorId: existingVendor.id,
        categoryId,
        source: "receipt_ai",
        sourceId: receipt.id,
        receipt: receipt.fileName // Simple reference string
      }
    });

    // Link Receipt back to Expense
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { expenseId: expense.id, status: "completed" }
    });

    return NextResponse.json({ success: true, expenseId: expense.id });

  } catch (error) {
    log.error("Convert Receipt error", { module: "receipts", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Conversion failed" }, { status: 500 });
  }
}
