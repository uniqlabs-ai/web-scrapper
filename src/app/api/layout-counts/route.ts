import { NextResponse } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    const apInbox = await prisma.receipt.count({
      where: { userId, status: "pending" }
    });

    const reconcile = await prisma.bankTransaction.count({
      where: { userId, isReconciled: false }
    });

    return NextResponse.json({ apInbox, reconcile });
  } catch {
    return NextResponse.json({ apInbox: 0, reconcile: 0 });
  }
}
