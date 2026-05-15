import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { createRazorpayContact, createFundAccount, executePayout } from "@/lib/payouts";
import { ApInboxApprovalSchema } from "@/lib/schemas";
import { log, toLogError } from "@/lib/logger";

export async function GET(_request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();

    const pendingApprovals = await prisma.expenseApproval.findMany({
      take: 500,
      where: {
        approverId: userId,
        status: "pending",
        expense: { source: "email_inbox" }
      },
      include: {
        expense: {
          include: { receipts: true }
        }
      },
      orderBy: { createdAt: "desc" },
    });

    const entries = pendingApprovals.filter(a => a.expense).map(a => {
      const e = a.expense!;
      const r = e.receipts?.[0]; // Assume 1 receipt per OCR'd expense
      
      let extraction = {};
      if (r?.extractedData) {
        try { extraction = JSON.parse(r.extractedData); } catch (e: unknown) {
          log.warn("Malformed extractedData JSON", { module: "ap-inbox", action: "list", meta: { receiptId: r.id, error: e instanceof Error ? e.message : String(e) } });
        }
      }

      return {
        approvalId: a.id,
        expenseId: e.id,
        description: e.description,
        amount: Number(e.amount),
        currency: e.currency,
        date: e.date.toISOString(),
        vendor: e.vendor,
        category: e.categoryId,
        receipt: r ? { id: r.id, fileName: r.fileName, imageData: r.imageData, confidence: Number(r.confidence), extraction } : null,
        comments: a.comments,
        submittedAt: a.createdAt.toISOString()
      };
    });

    return NextResponse.json({ inbox: entries });
  } catch (err) {
    log.error("AP Inbox GET error", { module: "ap-inbox", action: "handler", error: toLogError(err) });
    return NextResponse.json({ error: "Failed to fetch AP Inbox" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = ApInboxApprovalSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { approvalId, action, finalAmount, finalVendor, finalCategory } = parsed.data;

    const approval = await prisma.expenseApproval.findFirst({
      where: { id: approvalId, approverId: userId, status: "pending" },
      include: { expense: true }
    });

    if (!approval) return NextResponse.json({ error: "Approval not found or already processed" }, { status: 404 });

    if (action === "approve") {
      let categoryId = approval.expense.categoryId;

      // Try finding or creating the category
      if (finalCategory) {
        let cat = await prisma.expenseCategory.findFirst({ where: { name: finalCategory, userId } });
        if (!cat) {
            cat = await prisma.expenseCategory.create({ data: { name: finalCategory, userId, organizationId: approval.expense.organizationId } });
        }
        categoryId = cat.id;
      }

      // 1. Update Expense records
      await prisma.expense.update({
        where: { id: approval.expense.id },
        data: {
          amount: finalAmount || approval.expense.amount,
          vendor: finalVendor || approval.expense.vendor,
          categoryId: categoryId || approval.expense.categoryId,
        }
      });

      // 2. Mark Approval as approved
      await prisma.expenseApproval.update({
        where: { id: approvalId },
        data: { status: "approved" }
      });

      // 3. Initiate Real RazorpayX Payment
      const bankAccount = await prisma.bankAccount.findFirst({
        where: { userId, isActive: true },
        orderBy: { currentBalance: "desc" }
      });

      if (bankAccount) {
        const amt = finalAmount || Number(approval.expense.amount);
        const vendorName = finalVendor || approval.expense.vendor || "Unknown Vendor";
        const currency = approval.expense.currency || "INR";

        // Enforce authentic vendor connection and routing bounds mapping
        if (!approval.expense.vendorId) {
          return NextResponse.json({ error: "Invoice is not linked to an onboarded Vendor. Cannot dispatch real payment." }, { status: 400 });
        }
        
        const vendor = await prisma.vendor.findUnique({ where: { id: approval.expense.vendorId } });
        if (!vendor || !vendor.bankAccount || !vendor.bankIfsc) {
          return NextResponse.json({ error: "Linked Vendor lacks registered Bank Account or IFSC coordinates. Payout halted." }, { status: 400 });
        }

        // Call the payout engine
        const rzpContactId = await createRazorpayContact({
           name: vendorName,
           type: "vendor",
           reference_id: `v_${approval.expense.id}`
        });

        const rzpFundAccountId = await createFundAccount({
           contact_id: rzpContactId,
           bank_name: vendor.bankName || "Unknown Bank",
           account_number: vendor.bankAccount,
           ifsc: vendor.bankIfsc
        });

        const payoutId = await executePayout({
           fund_account_id: rzpFundAccountId,
           amount: amt,
           currency: currency as "INR" | "USD",
           mode: "IMPS",
           purpose: "vendor bill",
           source_bank_id: bankAccount.id
        });

        await prisma.$transaction([
          prisma.bankAccount.update({
             where: { id: bankAccount.id },
             data: { currentBalance: { decrement: amt } }
          }),
          prisma.bankTransaction.create({
            data: {
              date: new Date(),
              description: `AP Payout: ${vendorName}`,
              amount: amt,
              type: "debit",
              category: finalCategory || "Uncategorized",
              vendor: vendorName,
              source: "ap_inbox",
              reference: payoutId, // Log the authentic payout ID
              isReconciled: true,
              matchedExpenseId: approval.expense.id,
              bankAccountId: bankAccount.id,
              userId
            }
          })
        ]);
      }

      return NextResponse.json({ success: true, message: "Expense approved and payment initiated." });
    }

    if (action === "reject") {
        await prisma.expenseApproval.update({ where: { id: approvalId }, data: { status: "rejected" }});
        return NextResponse.json({ success: true, message: "Expense rejected." });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (err) {
    log.error("AP Inbox PATCH error", { module: "ap-inbox", action: "handler", error: toLogError(err) });
    return NextResponse.json({ error: "Failed to process approval" }, { status: 500 });
  }
}
