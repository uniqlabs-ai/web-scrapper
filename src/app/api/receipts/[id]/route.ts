import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const ReceiptIdParamSchema = z.object({
  id: z.string().min(1, "Receipt ID is required"),
});

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const { userId } = guard;
    const rawParams = await params;
    const paramsParsed = ReceiptIdParamSchema.safeParse(rawParams);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Validation failed", details: paramsParsed.error.issues }, { status: 400 });
    }
    const { id } = paramsParsed.data;

    // SECURITY: Verify receipt belongs to current user
    await prisma.receipt.delete({ where: { id, userId } });
    logAudit({ userId, action: "delete", resource: "receipt", resourceId: id });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    log.error("Delete receipt error", { module: "receipts", action: "handler", error: toLogError(error) });
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2025") {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete receipt" }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { id } = await params;

    // SECURITY: Verify receipt belongs to current user
    const receipt = await prisma.receipt.findUnique({
      where: { id, userId },
      include: { expense: true },
    });

    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    return NextResponse.json({ receipt });
  } catch (error) {
    log.error("Get receipt error", { module: "receipts", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to get receipt" }, { status: 500 });
  }
}
