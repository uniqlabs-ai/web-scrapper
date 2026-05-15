/**
 * Smart Transaction Categorizer
 *
 * Auto-classifies bank transactions based on description keywords/vendor tags.
 * Categories match the expense budget categories:
 *   Salaries, Infrastructure, Marketing, Software, Office, Travel,
 *   Food & Meals, Professional Services, Utilities, Insurance,
 *   Telecom & Internet, Equipment, Misc
 *
 * The system learns from user's manual tagging over time.
 */

export interface CategorizedResult {
  category: string;
  confidence: number; // 0–1
  vendor: string | null;
}

/**
 * Vendor-to-category mapping for common Indian transaction patterns.
 * Each entry: [regex pattern, vendor display name, category].
 * Categories must match the budget dropdown exactly.
 */
const VENDOR_RULES: [RegExp, string, string][] = [
  // ── Software ──
  [/vercel/i, "Vercel", "Software"],
  [/github/i, "GitHub", "Software"],
  [/gitlab/i, "GitLab", "Software"],
  [/atlassian|jira|confluence/i, "Atlassian", "Software"],
  [/slack/i, "Slack", "Software"],
  [/notion/i, "Notion", "Software"],
  [/figma/i, "Figma", "Software"],
  [/canva/i, "Canva", "Software"],
  [/adobe|photoshop|illustrator/i, "Adobe", "Software"],
  [/microsoft|ms\s?365|office\s?365/i, "Microsoft", "Software"],
  [/google\s?workspace|gsuite/i, "Google Workspace", "Software"],
  [/zoom(?!car)/i, "Zoom", "Software"],
  [/stripe/i, "Stripe", "Software"],
  [/razorpay/i, "Razorpay", "Software"],
  [/freshworks|freshdesk|freshsales/i, "Freshworks", "Software"],
  [/hubspot/i, "HubSpot", "Software"],
  [/intercom/i, "Intercom", "Software"],
  [/mailchimp/i, "Mailchimp", "Software"],
  [/sendgrid|resend/i, "Email Service", "Software"],
  [/twilio/i, "Twilio", "Software"],
  [/openai/i, "OpenAI", "Software"],
  [/anthropic/i, "Anthropic", "Software"],
  [/mongod?b|atlas/i, "MongoDB", "Software"],
  [/supabase/i, "Supabase", "Software"],
  [/netlify/i, "Netlify", "Software"],
  [/1password|lastpass|bitwarden/i, "Password Manager", "Software"],
  [/grammarly/i, "Grammarly", "Software"],
  [/calendly/i, "Calendly", "Software"],
  [/loom/i, "Loom", "Software"],
  [/miro/i, "Miro", "Software"],
  [/linear/i, "Linear", "Software"],
  [/postman/i, "Postman", "Software"],
  [/datadog|sentry/i, "Monitoring", "Software"],
  [/dropbox/i, "Dropbox", "Software"],
  [/zerodha|groww|upstox/i, "Trading Platform", "Software"],

  // ── Infrastructure ──
  [/aws|amazon\s?web/i, "AWS", "Infrastructure"],
  [/digitalocean/i, "DigitalOcean", "Infrastructure"],
  [/gcp|google\s?cloud/i, "Google Cloud", "Infrastructure"],
  [/azure/i, "Microsoft Azure", "Infrastructure"],
  [/cloudflare/i, "Cloudflare", "Infrastructure"],
  [/heroku/i, "Heroku", "Infrastructure"],
  [/render\.com|render\s/i, "Render", "Infrastructure"],
  [/railway/i, "Railway", "Infrastructure"],
  [/hetzner/i, "Hetzner", "Infrastructure"],
  [/linode|akamai/i, "Linode", "Infrastructure"],
  [/godaddy|bigrock|namecheap/i, "Domain Registrar", "Infrastructure"],
  [/hostinger/i, "Hostinger", "Infrastructure"],
  [/firebase/i, "Firebase", "Infrastructure"],

  // ── Marketing ──
  [/google\s?ads|adwords/i, "Google Ads", "Marketing"],
  [/meta\s?ads|facebook\s?ads|fb\s?ads/i, "Meta Ads", "Marketing"],
  [/linkedin\s?ads|linkedin\s?premium/i, "LinkedIn Ads", "Marketing"],
  [/twitter\s?ads|x\.com/i, "Twitter/X Ads", "Marketing"],
  [/instagram\s?ads/i, "Instagram Ads", "Marketing"],
  [/sponsor/i, "Sponsorship", "Marketing"],

  // ── Travel ──
  [/makemytrip|make\s?my\s?trip/i, "MakeMyTrip", "Travel"],
  [/cleartrip/i, "Cleartrip", "Travel"],
  [/goibibo/i, "Goibibo", "Travel"],
  [/irctc/i, "IRCTC", "Travel"],
  [/indigo|6e\d{3,4}/i, "IndiGo", "Travel"],
  [/spicejet/i, "SpiceJet", "Travel"],
  [/air\s?india/i, "Air India", "Travel"],
  [/vistara/i, "Vistara", "Travel"],
  [/uber(?!\s?eats)/i, "Uber", "Travel"],
  [/ola\s?(?:cab|ride|money)/i, "Ola", "Travel"],
  [/rapido/i, "Rapido", "Travel"],
  [/oyo/i, "OYO", "Travel"],
  [/booking\.com|bookingcom/i, "Booking.com", "Travel"],
  [/airbnb/i, "Airbnb", "Travel"],
  [/yatra/i, "Yatra", "Travel"],
  [/easemytrip/i, "EaseMyTrip", "Travel"],
  [/cab|taxi/i, "Cab/Taxi", "Travel"],
  [/zoomcar/i, "ZoomCar", "Travel"],

  // ── Food & Meals ──
  [/zomato/i, "Zomato", "Food & Meals"],
  [/swiggy/i, "Swiggy", "Food & Meals"],
  [/uber\s?eats/i, "Uber Eats", "Food & Meals"],
  [/dunzo/i, "Dunzo", "Food & Meals"],
  [/dominos|domino/i, "Domino's", "Food & Meals"],
  [/mcdonald|mcdonalds/i, "McDonald's", "Food & Meals"],
  [/starbucks/i, "Starbucks", "Food & Meals"],
  [/cafe\s?coffee|ccd/i, "Cafe Coffee Day", "Food & Meals"],
  [/bigbasket/i, "BigBasket", "Food & Meals"],
  [/blinkit|grofers/i, "Blinkit", "Food & Meals"],
  [/zepto/i, "Zepto", "Food & Meals"],
  [/instamart/i, "Instamart", "Food & Meals"],
  [/restaurant|cafe|food|meal|lunch|dinner/i, "Restaurant", "Food & Meals"],

  // ── Telecom & Internet ──
  [/airtel|bharti/i, "Airtel", "Telecom & Internet"],
  [/jio|reliance\s?jio/i, "Jio", "Telecom & Internet"],
  [/vodafone|vi\s/i, "Vodafone/Vi", "Telecom & Internet"],
  [/bsnl/i, "BSNL", "Telecom & Internet"],
  [/act\s?fibernet/i, "ACT Fibernet", "Telecom & Internet"],
  [/hathway/i, "Hathway", "Telecom & Internet"],
  [/tata\s?sky|tataplay/i, "Tata Play", "Telecom & Internet"],
  [/broadband|internet|wifi/i, "Internet Service", "Telecom & Internet"],
  [/recharge/i, "Recharge", "Telecom & Internet"],

  // ── Office ──
  [/wework|cowrks|91springboard|innov8/i, "Co-working Space", "Office"],
  [/rent|lease\s?rent/i, "Office Rent", "Office"],
  [/urban\s?clap|urbancompany/i, "Urban Company", "Office"],
  [/stationery|printing/i, "Office Supplies", "Office"],

  // ── Salaries ──
  [/salary|payroll|wages|stipend/i, "Salary Payment", "Salaries"],
  [/razorpayx\s?payroll|greythr|keka/i, "Payroll Service", "Salaries"],

  // ── Professional Services ──
  [/freelanc|contractor|consult/i, "Freelancer/Contractor", "Professional Services"],
  [/ca\s?fees|chartered\s?account/i, "CA Fees", "Professional Services"],
  [/legal|advocate|lawyer/i, "Legal Services", "Professional Services"],
  [/audit/i, "Audit Services", "Professional Services"],
  [/advisory/i, "Advisory", "Professional Services"],

  // ── Insurance ──
  [/lic\b|life\s?insur/i, "LIC", "Insurance"],
  [/icici\s?lombard|icici\s?prudential/i, "ICICI Insurance", "Insurance"],
  [/hdfc\s?ergo|hdfc\s?life/i, "HDFC Insurance", "Insurance"],
  [/bajaj\s?allianz/i, "Bajaj Allianz", "Insurance"],
  [/star\s?health/i, "Star Health", "Insurance"],
  [/policy\s?bazaar|policybazaar/i, "Policybazaar", "Insurance"],
  [/insur/i, "Insurance", "Insurance"],

  // ── Utilities ──
  [/bescom|electricity|power\s?bill|tata\s?power|adani/i, "Electricity", "Utilities"],
  [/bwssb|water\s?bill/i, "Water", "Utilities"],
  [/gas\s?bill|piped\s?gas/i, "Gas", "Utilities"],

  // ── Equipment ──
  [/amazon(?!\s?web)/i, "Amazon", "Equipment"],
  [/flipkart/i, "Flipkart", "Equipment"],
  [/apple\s?store|apple\.com/i, "Apple", "Equipment"],
  [/dell|lenovo|hp\s?store/i, "Computer Hardware", "Equipment"],
  [/croma|reliance\s?digital/i, "Electronics Store", "Equipment"],
  [/laptop|monitor|keyboard|mouse|headphone|hardware/i, "Hardware", "Equipment"],

  // ── Professional Services (CA / Accountant pattern) ──
  [/inf\/inft\/.*(ca|apoorva|accountant)/i, "CA Payment", "Professional Services"],

  // ── Misc (financial) ──
  [/fd\s?no|fixed\s?deposit|trf\s?to\s?fd/i, "Fixed Deposit", "Misc"],
  [/rev\s?imps|reversal|bil\/rev/i, "Reversal", "Misc"],
  [/interest\s/i, "Interest", "Misc"],
  [/gst|tds|tax\s?payment|income\s?tax|advance\s?tax|challan/i, "Tax/GST", "Misc"],
  [/grs\/.*commission|grs\/.*cgst|grs\/.*sgst|grs\/.*slab/i, "Bank Commission/GST", "Misc"],
  [/bank\s?charge|service\s?charge|maintenance\s?charge/i, "Bank Charges", "Misc"],
  [/emi\b|loan|repayment|mortgage/i, "Loan/EMI", "Misc"],
  [/mutual\s?fund|sip\b/i, "Investment", "Misc"],
];

// ── Keyword-based fallback rules ──
const KEYWORD_RULES: [RegExp, string][] = [
  [/atm|cash\s?withdrawal/i, "Misc"],
  [/cheque|chq|check/i, "Misc"],
  [/subscription/i, "Software"],
  [/refund/i, "Misc"],
];

/**
 * Extract person name from MMT/IMPS pattern:
 *   MMT/IMPS/5120122 68323/ANURAGUNI Q/HDFC0000141
 *   → "ANURAGUNI Q" (the person name is the 3rd slash-segment)
 */
function extractIMPSPersonName(desc: string): string | null {
  // MMT/IMPS/NUMBER/NAME/BANK_IFSC or MMT/IMPS/NUMBER/IMPS/NAME/BANK_IFSC
  const impsMatch = desc.match(/MMT\/IMPS\/[\d\s]+\/(?:IMPS\/)?([A-Za-z][A-Za-z ]+)\//i);
  if (impsMatch?.[1]) {
    return impsMatch[1].trim();
  }
  return null;
}

/**
 * Extract person name from INF/NEFT pattern:
 *   INF/NEFT/IN4260705 1852336/HDFC0000 910/MOHIUNIQ
 *   → "MOHIUNIQ" (the person name is the last slash-segment)
 *
 *   NEFT- AXOMB4047307765 3-PRATEEK GUPTA- -917010042448109
 *   → "PRATEEK GUPTA"
 */
function extractNEFTPersonName(desc: string): string | null {
  // INF/NEFT/NUMBER/IFSC/NAME — name is last segment
  const infNeft = desc.match(/INF\/(?:NEFT|INFT)\/[A-Z\d\s]+\/[A-Z\d\s]+\/([A-Za-z][A-Za-z ]+)/i);
  if (infNeft?.[1]) {
    return infNeft[1].trim();
  }
  // NEFT- AXOMB...-PERSON NAME-...
  const neft = desc.match(/NEFT-?\s*\w+\s*\d*-([A-Za-z][A-Za-z ]+)/i);
  if (neft?.[1]) {
    return neft[1].trim();
  }
  return null;
}

/**
 * Categorize a single transaction by description.
 * Optionally accepts txnType ("debit"/"credit") to improve categorization
 * for NEFT/IMPS transfers:
 *   - Debits to named individuals → Salaries
 *   - Credits from named individuals → Income / Revenue
 */
export function categorizeTransaction(description: string, txnType?: string): CategorizedResult {
  if (!description) {
    return { category: "Misc", vendor: null, confidence: 0 };
  }

  // Try vendor rules first (high confidence)
  for (const [pattern, vendor, category] of VENDOR_RULES) {
    if (pattern.test(description)) {
      return { category, vendor, confidence: 0.9 };
    }
  }

  // ── IMPS/NEFT person-name transfers ──
  // MMT/IMPS debits to named individuals → Salaries
  const isIMPS = /mmt\/imps/i.test(description);
  const isNEFT = /neft|inf\/neft|inf\/inft/i.test(description);
  const isDebit = txnType === "debit";

  if (isIMPS || isNEFT) {
    const personName = isIMPS
      ? extractIMPSPersonName(description)
      : extractNEFTPersonName(description);

    if (personName && isDebit) {
      return {
        category: "Salaries",
        vendor: personName,
        confidence: 0.75,
      };
    }
    if (personName) {
      return {
        category: "Misc",
        vendor: personName,
        confidence: 0.5,
      };
    }
  }

  // ── BIL/ONL bill payment — look for vendor in description ──
  if (/bil\/onl/i.test(description)) {
    const bilMatch = description.match(/bil\/onl\/[\d\s]+\/(.+)$/i);
    if (bilMatch?.[1]) {
      const bilVendor = bilMatch[1].trim();
      return { category: "Misc", vendor: bilVendor, confidence: 0.5 };
    }
  }

  // ── MSI/ payments (international SaaS) ── 
  if (/^msi\//i.test(description)) {
    const msiMatch = description.match(/msi\/([^/]+)/i);
    const msiVendor = msiMatch?.[1]?.trim();
    if (msiVendor) {
      return { category: "Software", vendor: msiVendor, confidence: 0.7 };
    }
  }

  // Try keyword fallback (medium confidence)
  for (const [pattern, category] of KEYWORD_RULES) {
    if (pattern.test(description)) {
      return { category, vendor: extractVendorFromDesc(description), confidence: 0.5 };
    }
  }

  // No match — low confidence
  return { category: "Misc", vendor: extractVendorFromDesc(description), confidence: 0.1 };
}

/**
 * Batch categorize, with credit-type defaulting to "Income / Revenue".
 */
export function batchCategorize(
  transactions: { description: string; amount: number; type: string }[]
): CategorizedResult[] {
  return transactions.map((tx) => {
    const result = categorizeTransaction(tx.description);
    if (tx.type === "credit" && result.confidence <= 0.1) {
      return { ...result, category: "Income / Revenue", confidence: 0.6 };
    }
    return result;
  });
}

/**
 * Extract vendor name from description heuristics.
 */
function extractVendorFromDesc(desc: string): string | null {
  // UPI: "UPI/408234234/VendorName/..."
  const upi = desc.match(/upi[/-]\d+[/-]([^/\-]+)/i);
  if (upi) return cleanVendorName(upi[1]);

  // POS: "POS VENDOR NAME"
  const pos = desc.match(/pos[/\- ]+(.+?)(?:\/|$)/i);
  if (pos) return cleanVendorName(pos[1]);

  return null;
}

function cleanVendorName(name: string): string {
  return name
    .replace(/\d{10,}/g, "")     // Remove long numbers
    .replace(/[@#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

/**
 * Budget expense categories with colors for the UI.
 * These match the dropdown in the budget page exactly.
 */
export const EXPENSE_CATEGORIES = [
  { name: "Salaries", color: "#6366F1", icon: "👥" },
  { name: "Infrastructure", color: "#8B5CF6", icon: "☁️" },
  { name: "Marketing", color: "#EC4899", icon: "📢" },
  { name: "Software", color: "#A855F7", icon: "💻" },
  { name: "Office", color: "#F43F5E", icon: "🏢" },
  { name: "Travel", color: "#EF4444", icon: "✈️" },
  { name: "Food & Meals", color: "#F97316", icon: "🍽️" },
  { name: "Professional Services", color: "#EAB308", icon: "⚖️" },
  { name: "Utilities", color: "#22C55E", icon: "⚡" },
  { name: "Insurance", color: "#14B8A6", icon: "🛡️" },
  { name: "Telecom & Internet", color: "#06B6D4", icon: "📡" },
  { name: "Equipment", color: "#3B82F6", icon: "🖥️" },
  { name: "Misc", color: "#9CA3AF", icon: "📦" },
];
