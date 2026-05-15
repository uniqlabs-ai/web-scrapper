import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";

// ── Generic name extraction (transfer-type agnostic) ──

/** Strip bank prefixes, numeric tokens, and extract a clean recipient name. */
function extractRecipientName(raw: string): string {
  if (!raw) return "";
  // Strip everything after '~' (duplicate bank ref noise)
  let cleaned = raw.includes("~") ? raw.split("~")[0] : raw;

  // Smart prefix stripping — strip only the bank transport code, preserve the vendor name
  // MSI/ and MIN/ — next token IS the vendor name (MSI/VERCEL INC → VERCEL INC)
  cleaned = cleaned.replace(/^(MSI|MIN)\//, "");
  // BIL/ONL/ — strip ref number to get vendor (BIL/ONL/001174143 662/Indigo Air)
  cleaned = cleaned.replace(/^BIL\/ONL\/\S*\s*/, "");
  // MMT/IMPS/xxx — strip long ref then get to the name (after /)
  cleaned = cleaned.replace(/^MMT\/IMPS\/\S+\s*/, "");
  // INF/NEFT/ or INF/INFT/ — strip ref and get name
  cleaned = cleaned.replace(/^INF\/(NEFT|INFT)\/\S+\s*/, "");
  // GRS/ GIB/ and other simple single-segment prefixes
  cleaned = cleaned.replace(/^(GRS|GIB|UPI|CMS)\/\S*\s*/, "");
  // FT-MPS- prefix
  cleaned = cleaned.replace(/^FT-MPS-\S*\s*/, "");
  // Generic fallback: standalone short prefix like TRF
  cleaned = cleaned.replace(/^[A-Z]{2,4}\//, "");

  // Remove payment/transaction reference numbers
  cleaned = cleaned.replace(/\bP\d{10,}\b/g, "").trim();
  cleaned = cleaned.replace(/\b\d{8,}\b/g, "").trim();

  // Remove IFSC codes — full (UTIB0003100) and partial fragments (UTIB, HDFC, SBIN, SRCB, IDIB, MAHB, STCB, CNRB, PUNB)
  cleaned = cleaned.replace(/\b[A-Z]{4}0\d{3,6}\b/g, "").trim();
  cleaned = cleaned.replace(/\b(UTIB|HDFC|SBIN|ICIC|SRCB|IDIB|MAHB|STCB|CNRB|PUNB|KKBK|IOBA|BARB|UBIN|CORP|CBIN|BKID|ALLA|ANDB|UCBA|VIJB)\d*\b/g, "").trim();

  // Remove date-like patterns (YYYYMMDD, YYMM...)
  cleaned = cleaned.replace(/\b20\d{6,}\b/g, "").trim();
  cleaned = cleaned.replace(/\/\d{6,}\//g, "/").trim();

  // Remove remaining short digit sequences
  cleaned = cleaned.replace(/\b\d{4,7}\b/g, "").trim();

  // Look for company name pattern (words ending with Ltd/Inc/COM/Services etc.)
  const companyMatch = cleaned.match(
    /([A-Z][A-Za-z\s]+(?:Ltd|Limited|LLP|Corp|Inc|Pvt|Technologies|Services|Solutions|Payment|Consulting|Bank|Insurance|Cloud|COM)\b\.?)/i
  );
  if (companyMatch) return companyMatch[1].trim();

  // Extract alphabetic word sequences (the actual name)
  const tokens = cleaned.split(/[\s\/]+/);
  const nameTokens: string[] = [];
  for (const t of tokens) {
    // Skip very short fragments (< 2 chars), pure numbers, and known noise
    if (t.length < 2) continue;
    if (/^\d+$/.test(t)) continue;
    if (/^[A-Za-z]/.test(t)) {
      nameTokens.push(t);
    }
  }
  let name = nameTokens.slice(0, 4).join(" ").trim();
  // Remove trailing noise
  name = name.replace(/\s+Unit\s+\w+.*$/i, "").trim();
  name = name.replace(/\s+\d{4,}.*$/, "").trim();

  return name.length >= 2 ? name : raw.slice(0, 40);
}

/** Normalize for grouping (case-insensitive, strip common suffixes) */
function normalizeForGrouping(s: string): string {
  return s
    .toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\bcorporation\b/g, "corp")
    .replace(/\bincorporated\b/g, "inc")
    .replace(/\bprivate\b/g, "pvt")
    .replace(/[^a-z0-9]/g, "");
}

// ── Classification heuristics ──

const KNOWN_SAAS_KEYWORDS = [
  "vercel", "openai", "render", "aws", "azure", "google", "github",
  "netlify", "heroku", "stripe", "razorpay", "slack", "notion",
  "figma", "canva", "zoom", "hubspot", "mailchimp", "sendgrid",
  "twilio", "datadog", "sentry", "cloudflare", "digitalocean",
  "supabase", "firebase", "mongodb", "redis", "postmark", "resend",
];

const COMPANY_SUFFIXES = /\b(ltd|limited|llp|corp|inc|pvt|technologies|services|solutions|payment|consulting|bank|insurance|cloud|com)\b/i;

function looksLikePersonName(name: string): boolean {
  // Person names: 1-3 short words, no company suffixes
  if (COMPANY_SUFFIXES.test(name)) return false;
  const words = name.trim().split(/\s+/);
  if (words.length > 4) return false;
  // All words should be alpha-only (no numbers)
  return words.every((w) => /^[A-Za-z]+$/.test(w));
}

function looksLikeCompanyName(name: string): boolean {
  if (COMPANY_SUFFIXES.test(name)) return true;
  const lower = name.toLowerCase();
  return KNOWN_SAAS_KEYWORDS.some((kw) => lower.includes(kw));
}

interface Suggestion {
  name: string;
  avgAmount: number;
  totalAmount: number;
  count: number;
  distinctMonths: number;
  months: string[];
  variance: number;
  isConsistent: boolean;
  frequency: string;
  kind: "subscription" | "payroll_fixed" | "payroll_variable" | "unknown";
  confidence: number;
  sampleDescriptions: string[];
}

function classifySuggestion(
  name: string,
  avgAmount: number,
  variance: number,
  distinctMonths: number,
): { kind: Suggestion["kind"]; confidence: number } | null {
  const isPerson = looksLikePersonName(name);
  const isCompany = looksLikeCompanyName(name);
  const isConsistent = variance < 20;
  const isSmallAmount = avgAmount < 10000;
  const isPayrollRange = avgAmount >= 5000 && avgAmount <= 500000;

  // ── Exclusions: things that are neither subscription nor payroll ──
  // FD transfers, tax payments, generic noise
  if (/\b(TRF|FD\s*no|DTAX|TAX\s*DEDUCTED|GST\s*PAYMENT)\b/i.test(name)) return null;
  // Very short names that are likely noise (single letter, abbreviations) — skip if < 3 alpha chars
  if (name.replace(/[^a-zA-Z]/g, "").length < 3) return null;

  let subscriptionScore = 0;
  let payrollScore = 0;

  // Company name signals
  if (isCompany) subscriptionScore += 3;
  if (isPerson) payrollScore += 3;

  // Amount consistency
  if (isConsistent && isSmallAmount) subscriptionScore += 2;
  if (isPayrollRange) payrollScore += 1;

  // Known SaaS
  if (KNOWN_SAAS_KEYWORDS.some((kw) => name.toLowerCase().includes(kw))) subscriptionScore += 3;

  // Recurring frequency
  if (distinctMonths >= 3) {
    subscriptionScore += 1;
    payrollScore += 1;
  }

  // Bank fees / commissions / GST — always subscription category
  if (/\b(commission|cgst|sgst|slab|fee|charge|interest)\b/i.test(name)) {
    subscriptionScore += 4;
    payrollScore -= 2;
  }

  // Travel / purchases — subscription category (variable), not payroll
  if (/\b(air|makemytrip|indigo|flight|hotel|travel|airbnb|cleartrip|zoomcar|blusmart|atlys|amazon|google|play)\b/i.test(name)) {
    subscriptionScore += 2;
    payrollScore -= 3;
  }

  // VFS / visa / insurance — subscription, not payroll
  if (/\b(vfs|global|worldline|insurance|spinsurance)\b/i.test(name)) {
    subscriptionScore += 2;
    payrollScore -= 2;
  }

  const totalScore = subscriptionScore + payrollScore;
  const confidence = Math.min(Math.round((Math.abs(subscriptionScore - payrollScore) / Math.max(totalScore, 1)) * 100), 100);

  if (subscriptionScore > payrollScore) {
    return { kind: "subscription", confidence };
  }
  if (payrollScore > subscriptionScore) {
    return { kind: isConsistent ? "payroll_fixed" : "payroll_variable", confidence };
  }
  return { kind: "unknown", confidence: 0 };
}

function guessFrequency(months: string[]): string {
  if (months.length < 2) return "monthly";
  const sorted = months.sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const [y1, m1] = sorted[i - 1].split("-").map(Number);
    const [y2, m2] = sorted[i].split("-").map(Number);
    gaps.push((y2 - y1) * 12 + (m2 - m1));
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avgGap <= 1.2) return "monthly";
  if (avgGap <= 3.5) return "quarterly";
  if (avgGap <= 7) return "half-yearly";
  return "yearly";
}

// ── API Handler ──

export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();

    // Fetch all data in parallel
    const [expenses, existingRecurring, existingEmployees, existingVendors] = await Promise.all([
      prisma.expense.findMany({
      take: 10000,
        where: { userId },
        select: { description: true, amount: true, date: true, vendor: true },
        orderBy: { date: "desc" },
      }),
      prisma.recurringExpense.findMany({
      take: 10000,
        where: { userId, isActive: true },
        select: { description: true, vendor: true },
      }),
      prisma.employee.findMany({
      take: 10000,
        where: { userId, isActive: true },
        select: { name: true },
      }),
      prisma.vendor.findMany({
      take: 10000,
        where: { userId, isActive: true },
        select: { name: true },
      }),
    ]);

    // Build exclusion sets
    const excludeSet = new Set<string>();
    for (const r of existingRecurring) {
      if (r.description) excludeSet.add(normalizeForGrouping(r.description));
      if (r.vendor) excludeSet.add(normalizeForGrouping(r.vendor));
    }
    for (const e of existingEmployees) {
      excludeSet.add(normalizeForGrouping(e.name));
    }
    const vendorExcludeSet = new Set<string>();
    for (const v of existingVendors) {
      vendorExcludeSet.add(normalizeForGrouping(v.name));
    }

    // Group expenses by normalized recipient name
    const groups: Record<string, {
      name: string;
      amounts: number[];
      months: Set<string>;
      descriptions: string[];
    }> = {};

    for (const exp of expenses) {
      const rawName = extractRecipientName(exp.description);
      const key = normalizeForGrouping(rawName);
      if (key.length < 2) continue;

      if (!groups[key]) {
        groups[key] = { name: rawName, amounts: [], months: new Set(), descriptions: [] };
      }
      groups[key].amounts.push(Number(exp.amount));
      groups[key].months.add(exp.date.toISOString().slice(0, 7));
      if (groups[key].descriptions.length < 3) {
        groups[key].descriptions.push(exp.description.slice(0, 80));
      }
    }

    // Build suggestions from groups with 2+ distinct months
    const subscriptions: Suggestion[] = [];
    const payroll: Suggestion[] = [];

    for (const [key, group] of Object.entries(groups)) {
      if (group.months.size < 2) continue;
      if (excludeSet.has(key)) continue;

      const avg = group.amounts.reduce((a, b) => a + b, 0) / group.amounts.length;
      const min = Math.min(...group.amounts);
      const max = Math.max(...group.amounts);
      const variance = avg > 0 ? ((max - min) / avg) * 100 : 0;
      const monthsList = Array.from(group.months).sort();
      const freq = guessFrequency(monthsList);
      const { kind, confidence } = classifySuggestion(group.name, avg, variance, group.months.size) || { kind: null, confidence: 0 };
      if (!kind) continue; // excluded by heuristic

      const suggestion: Suggestion = {
        name: group.name,
        avgAmount: Math.round(avg),
        totalAmount: Math.round(group.amounts.reduce((a, b) => a + b, 0)),
        count: group.amounts.length,
        distinctMonths: group.months.size,
        months: monthsList,
        variance: Math.round(variance),
        isConsistent: variance < 20,
        frequency: freq,
        kind,
        confidence,
        sampleDescriptions: group.descriptions,
      };

      if (kind === "subscription" || kind === "unknown") {
        subscriptions.push(suggestion);
      }
      if (kind.startsWith("payroll") || kind === "unknown") {
        payroll.push(suggestion);
      }
    }

    // Sort by confidence * months for relevance
    const sortFn = (a: Suggestion, b: Suggestion) =>
      b.confidence * b.distinctMonths - a.confidence * a.distinctMonths;
    subscriptions.sort(sortFn);
    payroll.sort(sortFn);

    // Build vendor suggestions — all unique expense sources with 2+ occurrences, not already tracked
    const vendors: Suggestion[] = [];
    for (const [key, group] of Object.entries(groups)) {
      if (group.amounts.length < 2) continue;
      if (vendorExcludeSet.has(key)) continue;
      const avg = group.amounts.reduce((a, b) => a + b, 0) / group.amounts.length;
      const total = group.amounts.reduce((a, b) => a + b, 0);
      const monthsList = Array.from(group.months).sort();
      vendors.push({
        name: group.name,
        avgAmount: Math.round(avg),
        totalAmount: Math.round(total),
        count: group.amounts.length,
        distinctMonths: group.months.size,
        months: monthsList,
        variance: 0,
        isConsistent: false,
        frequency: guessFrequency(monthsList),
        kind: "subscription",
        confidence: 50,
        sampleDescriptions: group.descriptions,
      });
    }
    vendors.sort((a, b) => b.totalAmount - a.totalAmount);

    return NextResponse.json({
      subscriptions,
      payroll,
      vendors,
      stats: {
        totalExpenses: expenses.length,
        uniqueVendors: Object.keys(groups).length,
        subscriptionCandidates: subscriptions.length,
        payrollCandidates: payroll.length,
        vendorCandidates: vendors.length,
      },
    });
  } catch (error) {
    log.error("Detect recurring error", { module: "detect-recurring", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Detection failed" }, { status: 500 });
  }
}
