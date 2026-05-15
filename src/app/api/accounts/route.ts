import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { CreateBankAccountSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { log, toLogError } from "@/lib/logger";

export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const accounts = await prisma.account.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 500, // RELIABILITY: Query boundary
    });
    return NextResponse.json({ accounts });
  } catch (error) {
    if (error instanceof TenantError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    log.error("List accounts error", { module: "accounts", action: "list", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to list accounts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "accounts" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const raw = await request.json();
    const result = CreateBankAccountSchema.safeParse(raw);

    if (!result.success) {
      return NextResponse.json({ error: "Invalid payload", details: result.error.issues }, { status: 400 });
    }

    const { name, accountType, currentBalance, currency } = result.data;

    const account = await prisma.account.create({
      data: {
        userId,
        organizationId,
        name,
        type: accountType || "bank",
        currentBalance: currentBalance || 0,
        currency: currency || "INR",
      },
    });

    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    log.error("Create account error", { module: "accounts", action: "create", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
