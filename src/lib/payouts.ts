export interface ContactInput {
  name: string;
  email?: string;
  contact?: string; // Phone number
  type: "vendor" | "employee" | "customer";
  reference_id?: string;
}

export interface FundAccountInput {
  contact_id: string;
  bank_name: string;
  account_number: string;
  ifsc: string;
}

export interface PayoutInput {
  fund_account_id: string;
  amount: number; // In base currency format (e.g. INR is rupees, the logic will convert to paise internally)
  currency: "INR" | "USD"; 
  mode: "NEFT" | "RTGS" | "IMPS" | "UPI";
  purpose: "vendor bill" | "salary" | "refund" | "cashback" | "payout";
  source_bank_id?: string; // Where is it deducting from internally
}

// Helper for authorization headers
function getHeaders() {
  const RZP_X_KEY = process.env.RAZORPAYX_KEY_ID as string;
  const RZP_X_SECRET = process.env.RAZORPAYX_KEY_SECRET as string;
  return {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${RZP_X_KEY}:${RZP_X_SECRET}`).toString("base64")}`,
  };
}

export async function createRazorpayContact(data: ContactInput) {
  if (!process.env.RAZORPAYX_KEY_ID || !process.env.RAZORPAYX_KEY_SECRET) {
    throw new Error("RazorpayX Credentials not configured.");
  }

  const res = await fetch("https://api.razorpay.com/v1/contacts", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`RazorpayX Contact Error: ${json.error?.description || "Unknown"}`);
  return json.id as string;
}

export async function createFundAccount(data: FundAccountInput) {
  if (!process.env.RAZORPAYX_KEY_ID || !process.env.RAZORPAYX_KEY_SECRET) {
    throw new Error("RazorpayX Credentials not configured.");
  }

  const res = await fetch("https://api.razorpay.com/v1/fund_accounts", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      contact_id: data.contact_id,
      account_type: "bank_account",
      bank_account: {
          name: data.bank_name,
          ifsc: data.ifsc,
          account_number: data.account_number
      }
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`RazorpayX FundAcc Error: ${json.error?.description || "Unknown"}`);
  return json.id as string;
}

export async function executePayout(data: PayoutInput) {
  if (!process.env.RAZORPAYX_KEY_ID || !process.env.RAZORPAYX_KEY_SECRET) {
    throw new Error("RazorpayX Credentials not configured.");
  }

  const amountInPaise = Math.round(data.amount * 100);

  const res = await fetch("https://api.razorpay.com/v1/payouts", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
        account_number: "2323230006730416", // A hypothetical Master Payout account
        fund_account_id: data.fund_account_id,
        amount: amountInPaise,
        currency: data.currency,
        mode: data.mode,
        purpose: data.purpose,
        queue_if_low_balance: true
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`RazorpayX Payout Error: ${json.error?.description || "Unknown"}`);
  return json.id as string; // Usually pout_XYZ
}
