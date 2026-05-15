import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const BankAccountSchema = z.object({
  name: z.string().max(200).optional(),
  bankName: z.string().max(200).optional(),
  accountNumber: z.string().max(30).optional(),
  accountLast4: z.string().max(4).optional(),
  accountType: z.enum(["savings", "current", "credit", "other"]).default("savings"),
  ifscCode: z.string().max(11).optional(),
  bankEmailDomains: z.string().max(500).optional(),
  currentBalance: z.number().default(0),
});

/**
 * GET /api/bank/accounts — List bank accounts with transaction counts
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const accounts = await prisma.bankAccount.findMany({
      take: 500,
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { transactions: true } },
      },
    });
    return NextResponse.json(accounts);
  } catch (error) {
    log.error("Bank accounts error", { module: "bank", action: "accounts", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bank/accounts — Create a bank account
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "bank-accounts" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = BankAccountSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    // Auto-extract last 4 digits if full account number is provided
    const accountNumber = body.accountNumber?.trim() || null;
    const accountLast4 =
      body.accountLast4?.trim() ||
      (accountNumber ? accountNumber.slice(-4) : null);

    const account = await prisma.bankAccount.create({
      data: {
        name: body.name?.trim() || `${body.bankName || "Bank"} Account`,
        bankName: body.bankName?.trim() || null,
        accountNumber,
        accountLast4,
        accountType: body.accountType,
        ifscCode: body.ifscCode?.trim() || null,
        bankEmailDomains: body.bankEmailDomains?.trim() || null,
        currentBalance: body.currentBalance,
        userId,
      },
      include: {
        _count: { select: { transactions: true } },
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    log.error("Create bank account error", { module: "bank", action: "accounts", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/bank/accounts — Update a bank account
 */
export async function PUT(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const body = await request.json();

    if (!body.id) {
      return NextResponse.json({ error: "Account ID required" }, { status: 400 });
    }

    // Verify ownership
    const existing = await prisma.bankAccount.findFirst({
      where: { id: body.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const accountNumber = body.accountNumber?.trim() ?? existing.accountNumber;
    const accountLast4 =
      body.accountLast4?.trim() ||
      (accountNumber ? accountNumber.slice(-4) : existing.accountLast4);

    const account = await prisma.bankAccount.update({
      where: { id: body.id },
      data: {
        ...(body.name && { name: body.name.trim() }),
        ...(body.bankName !== undefined && { bankName: body.bankName?.trim() || null }),
        ...(body.accountNumber !== undefined && { accountNumber }),
        accountLast4,
        ...(body.accountType && { accountType: body.accountType }),
        ...(body.ifscCode !== undefined && { ifscCode: body.ifscCode?.trim() || null }),
        ...(body.bankEmailDomains !== undefined && {
          bankEmailDomains: body.bankEmailDomains?.trim() || null,
        }),
        ...(body.currentBalance !== undefined && { currentBalance: body.currentBalance }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
      include: {
        _count: { select: { transactions: true } },
      },
    });

    return NextResponse.json(account);
  } catch (error) {
    log.error("Update bank account error", { module: "bank", action: "accounts", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/bank/accounts — Delete a bank account (and its transactions)
 */
export async function DELETE(request: NextRequest) {
  try {
    const guard = await requirePermission("delete");
    if (!guard.allowed) return guard.response;
    const { userId, organizationId } = guard;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Account ID required" }, { status: 400 });
    }

    const existing = await prisma.bankAccount.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    await prisma.bankAccount.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "bank_account", resourceId: id, details: { name: existing.name } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete bank account error", { module: "bank", action: "accounts", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}
