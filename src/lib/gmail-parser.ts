/**
 * Gmail Bank Email Parser — Dynamic Version
 *
 * Parses bank notification emails using generic patterns (no hardcoded banks).
 * Transaction matching to specific accounts is done by the sync route using
 * the registered bank accounts' last4 and email domain settings.
 */

export interface ParsedTransaction {
  amount: number;
  type: "credit" | "debit";
  description: string;
  date: Date;
  balance?: number;
  accountLast4?: string; // last 4 digits extracted from email
  bank?: string;        // bank name extracted from sender/body
  reference?: string;
}

// ── Generic patterns that work for ANY bank ──────────────────────

const DEBIT_PATTERNS = [
  /(?:debited|debit|spent|withdrawn|paid|purchase)[\s]*(?:by|of|for|from)?[\s]*(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)/i,
  /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)\s*(?:has been|was|is)\s*(?:debited|withdrawn|spent|charged)/i,
  /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)\s*(?:debited|deducted|spent|withdrawn)/i,
];

const CREDIT_PATTERNS = [
  /(?:credited|credit|received|deposited|refund)[\s]*(?:by|of|with|for|to)?[\s]*(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)/i,
  /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)\s*(?:has been|was|is)\s*(?:credited|received|deposited|refunded)/i,
  /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)\s*(?:credited|deposited|received)/i,
];

const BALANCE_PATTERNS = [
  /(?:balance|bal|avl\.?\s*bal|available\s*balance)\s*(?:is|:)?\s*(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)/i,
  /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)\s*(?:balance|available)/i,
];

const ACCOUNT_PATTERNS = [
  /(?:a\/c|acct?|account)\s*(?:no\.?|number|#)?\s*(?:ending\s*(?:with|in))?\s*[Xx*]*(\d{4})/i,
  /[Xx*]+(\d{4})\s*(?:has been|was|is)/i,
  /(?:card|a\/c)\s*(?:ending|no\.?)\s*(\d{4})/i,
];

const REF_PATTERN = /(?:Ref\s*(?:No|#)?\.?\s*:?\s*|UPI\s*Ref\s*:?\s*|UTR\s*:?\s*)([A-Za-z0-9]+)/i;

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, ""));
}

function extractDescription(body: string): string {
  const merchantPatterns = [
    /(?:to|at|towards|for|Info:)\s+([A-Za-z0-9\s&\-\.]+?)(?:\s+on|\s+Ref|\s+UPI|\.|$)/i,
    /(?:UPI|IMPS|NEFT|RTGS)\s*[-/]?\s*([A-Za-z0-9\s&\-\.]+?)(?:\s+on|\s+Ref|\.|$)/i,
    /(?:VPA|payee)\s*:?\s*([a-zA-Z0-9@.\-]+)/i,
  ];

  for (const pattern of merchantPatterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return match[1].trim().substring(0, 100);
    }
  }

  return body.substring(0, 60).replace(/\n/g, " ").trim();
}

/**
 * Extract the bank name from the sender email address.
 * e.g. "alerts@icicibank.com" → "ICICI"
 */
function extractBankFromSender(sender: string): string {
  const senderLower = sender.toLowerCase();

  // Common Indian bank domain → name mappings
  const knownBanks: [string, string][] = [
    ["icicibank", "ICICI"],
    ["hdfcbank", "HDFC"],
    ["axisbank", "Axis"],
    ["sbi.co.in", "SBI"],
    ["onlinesbi", "SBI"],
    ["kotak", "Kotak"],
    ["yesbank", "Yes Bank"],
    ["indusind", "IndusInd"],
    ["rblbank", "RBL"],
    ["federalbank", "Federal"],
    ["idfcfirst", "IDFC First"],
    ["bankofbaroda", "Bank of Baroda"],
    ["pnb", "PNB"],
    ["canarabank", "Canara"],
    ["unionbank", "Union Bank"],
    ["indianbank", "Indian Bank"],
    ["bandhan", "Bandhan"],
  ];

  for (const [domain, name] of knownBanks) {
    if (senderLower.includes(domain)) return name;
  }

  return "Unknown";
}

/**
 * Parse a bank notification email to extract transaction details.
 * This is bank-agnostic — uses generic patterns.
 */
export function parseBankEmail(
  subject: string,
  body: string,
  sender: string,
  date: Date
): ParsedTransaction | null {
  const fullText = `${subject} ${body}`;

  let amount: number | null = null;
  let type: "credit" | "debit" | null = null;

  // Try debit patterns
  for (const pattern of DEBIT_PATTERNS) {
    const match = fullText.match(pattern);
    if (match?.[1]) {
      amount = parseAmount(match[1]);
      type = "debit";
      break;
    }
  }

  // Try credit patterns if no debit found
  if (!amount) {
    for (const pattern of CREDIT_PATTERNS) {
      const match = fullText.match(pattern);
      if (match?.[1]) {
        amount = parseAmount(match[1]);
        type = "credit";
        break;
      }
    }
  }

  if (!amount || !type) return null;

  // Extract balance
  let balance: number | undefined;
  for (const pattern of BALANCE_PATTERNS) {
    const balMatch = fullText.match(pattern);
    if (balMatch?.[1]) {
      balance = parseAmount(balMatch[1]);
      break;
    }
  }

  // Extract account last 4 digits
  let accountLast4: string | undefined;
  for (const pattern of ACCOUNT_PATTERNS) {
    const accMatch = fullText.match(pattern);
    if (accMatch?.[1]) {
      accountLast4 = accMatch[1];
      break;
    }
  }

  // Extract reference
  const refMatch = fullText.match(REF_PATTERN);

  return {
    amount,
    type,
    description: extractDescription(body),
    date,
    balance,
    accountLast4,
    bank: extractBankFromSender(sender),
    reference: refMatch?.[1],
  };
}

/**
 * Check if an email is likely a bank transaction alert.
 * Uses both keyword matching and optional user-provided bank domains.
 *
 * @param subject - Email subject line
 * @param sender - Email sender (e.g. "alerts@icicibank.com")
 * @param userBankDomains - Optional list of domains from user's registered accounts
 */
export function isBankAlert(
  subject: string,
  sender: string,
  userBankDomains?: string[]
): boolean {
  const subjectLower = subject.toLowerCase();
  const senderLower = sender.toLowerCase();

  // Transaction keywords in subject
  const bankKeywords = [
    "debit", "credit", "transaction", "alert", "a/c", "account",
    "debited", "credited", "spent", "received", "withdrawn",
    "upi", "imps", "neft", "rtgs", "purchase", "refund",
    "payment", "transfer", "emi",
  ];
  const hasBankSubject = bankKeywords.some((k) => subjectLower.includes(k));
  if (!hasBankSubject) return false;

  // Check against user's registered bank domains
  if (userBankDomains?.length) {
    const matchesUserDomain = userBankDomains.some((d) =>
      senderLower.includes(d.toLowerCase())
    );
    if (matchesUserDomain) return true;
  }

  // Fallback: check known bank-like patterns
  const genericBankPatterns = [
    "bank", "alerts@", "noreply@", "transaction", "statement",
  ];
  return genericBankPatterns.some((p) => senderLower.includes(p));
}
