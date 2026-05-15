import { prisma } from "../src/lib/prisma";
import { executePayout, createRazorpayContact, createFundAccount } from "../src/lib/payouts";

async function run() {
  const approval = await prisma.expenseApproval.findFirst({
    where: { status: "pending", comments: "Parsed automatically via E2E Tester" },
    include: { expense: true }
  });

  if (!approval) {
    console.log("No pending E2E test approvals found.");
    return;
  }

  const amt = Number(approval.expense.amount);
  const vendorName = approval.expense.vendor;
  const currency = approval.expense.currency as "INR" | "USD";

  console.log(`Approving Expense for ${vendorName} for ${amt} ${currency}...`);

  // Call the Payout Engine directly to test
  try {
      console.log("1. Creating Contact...");
      const rzpContactId = await createRazorpayContact({
          name: vendorName || "Unknown Vendor",
          type: "vendor",
          reference_id: `v_${approval.expense.id}`
      });

      console.log(`2. Contact Bound: ${rzpContactId}, creating Fund Account...`);
      const rzpFundAccountId = await createFundAccount({
          contact_id: rzpContactId,
          bank_name: "HDFC Bank", 
          account_number: "5010023456789", 
          ifsc: "HDFC0001234" 
      });

      console.log(`3. Fund Account Bound: ${rzpFundAccountId}, executing Payout...`);
      const payoutId = await executePayout({
          fund_account_id: rzpFundAccountId,
          amount: amt,
          currency: currency === "USD" ? "INR" : currency, // Enforcing INR for sandbox
          mode: "IMPS",
          purpose: "vendor bill",
          source_bank_id: "e2etester"
      });

      console.log(`✅ [SUCCESS] Genuine Wire Initiated! Payout ID: ${payoutId}`);
      
      await prisma.expenseApproval.update({
        where: { id: approval.id },
        data: { status: "approved" }
      });

  } catch(e) {
      console.error("Payout Failed:", e);
  }
}

run();
