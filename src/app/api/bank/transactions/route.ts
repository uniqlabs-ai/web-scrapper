import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { UpdateBankTransactionSchema, CreateBankTransactionSchema } from "@/lib/schemas";

/**
 * GET /api/bank/transactions — List bank transactions
 * Query params: bankAccountId, page, limit, category, type, search,
 *               startDate, endDate, isReconciled
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const bankAccountId = searchParams.get("bankAccountId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const category = searchParams.get("category");
    const type = searchParams.get("type"); // debit | credit
    const search = searchParams.get("search");
    const startDate = searchParams.get("startDate") || searchParams.get("from");
    const endDate = searchParams.get("endDate") || searchParams.get("to");
    const isReconciled = searchParams.get("isReconciled");

    const where: Prisma.BankTransactionWhereInput = { userId };

    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (category) where.category = category;
    if (type) where.type = type;
    if (isReconciled !== null && isReconciled !== undefined) {
      where.isReconciled = isReconciled === "true";
    }
    if (search) {
      where.OR = [
        { description: { contains: search, mode: "insensitive" } },
        { vendor: { contains: search, mode: "insensitive" } },
        { reference: { contains: search, mode: "insensitive" } },
      ];
    }
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      where.date = dateFilter;
    }

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
      take: 500,
        where,
        orderBy: { date: "desc" },
        skip: (page - 1) * limit,
        include: {
          bankAccount: { select: { name: true, bankName: true } },
        },
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    // Summary stats
    const stats = await prisma.bankTransaction.groupBy({
      by: ["type"],
      where: { userId },
      _sum: { amount: true },
      _count: true,
    });

    const totalDebit =
      stats.find((s) => s.type === "debit")?._sum?.amount || 0;
    const totalCredit =
      stats.find((s) => s.type === "credit")?._sum?.amount || 0;

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalDebit: Number(totalDebit),
        totalCredit: Number(totalCredit),
        transactionCount: total,
      },
    });
  } catch (error) {
    log.error("Bank transactions error", { module: "bank", action: "transactions", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/bank/transactions — Update a transaction (category, vendor, reconcile)
 * Body: { id, category?, vendor?, isReconciled?, notes? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 30, prefix: "bank-tx-patch" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();

    const parsed = UpdateBankTransactionSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Transaction ID required" },
        { status: 400 }
      );
    }

    const transaction = await prisma.bankTransaction.update({
      where: { id, userId },
      data: {
        ...(updates.category !== undefined && { category: updates.category }),
        ...(updates.vendor !== undefined && { vendor: updates.vendor }),
        ...(updates.isReconciled !== undefined && {
          isReconciled: updates.isReconciled,
        }),
        ...(updates.notes !== undefined && { notes: updates.notes }),
      },
    });

    logAudit({ userId, action: "update", resource: "bankTransaction", resourceId: id, details: updates });
    return NextResponse.json(transaction);
  } catch (error) {
    log.error("Update transaction error", { module: "bank", action: "transactions", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to update transaction" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bank/transactions — Create a single transaction manually (e.g., resolving conflicts)
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "bank-tx-create" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();

    const parsed = CreateBankTransactionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { date, description, amount, type, bankAccountId, category, vendor, reference, hash } = parsed.data;

    // Verify bank account belongs to user
    const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, userId } });
    if (!account) {
      return NextResponse.json({ error: "Bank account not found" }, { status: 404 });
    }

    const tx = await prisma.bankTransaction.create({
      data: {
        date: new Date(date),
        description,
        amount,
        type,
        bankAccountId,
        userId,
        category,
        vendor,
        reference,
        hash: hash || undefined,
        source: "manual",
      }
    });

    logAudit({ userId, action: "create", resource: "bankTransaction", resourceId: tx.id, details: { amount, type, bankAccountId } });
    return NextResponse.json(tx);
  } catch (error: unknown) {
    log.error("Create transaction error", { module: "bank", action: "transactions", error: toLogError(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create transaction" },
      { status: 500 }
    );
  }
}
