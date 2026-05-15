import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { CreateRevenueSchema } from "@/lib/schemas";
import { log, toLogError } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Extract clean company name from raw text (bank refs, noisy client names).
 * Handles: GRS/xxx 80131 Solar Punk Ltd~..., BILL TO:) Solar Punk LTD  Unit A30..., etc.
 */
function extractCleanName(raw: string): string {
  if (!raw) return "";
  // Strip 'BILL TO:)' prefix and address noise
  let cleaned = raw.replace(/^BILL\s*TO[:\s)]+/i, "").trim();
  // Strip everything after '~' (bank ref duplicate)
  cleaned = cleaned.includes("~") ? cleaned.split("~")[0] : cleaned;
  // Remove GRS/NEFT/RTGS/IMPS/UPI prefix and numeric sequences
  cleaned = cleaned.replace(/^(GRS|NEFT|RTGS|IMPS|UPI|IFT)\/\S+\s*/i, "");
  // Remove payment refs (P followed by 12+ digits)
  cleaned = cleaned.replace(/\bP\d{10,}\b/g, "").trim();
  // Look for company name pattern (words starting with letter, possibly ending with Ltd/Limited/Inc etc)
  const companyMatch = cleaned.match(/([A-Z][A-Za-z\s]+(?:Ltd|Limited|LLP|Corp|Inc|Pvt|Technologies|Services|Solutions|Payment|Consulting)\.?)/i);
  if (companyMatch) return companyMatch[1].trim();
  // Otherwise find the first sequence of alphabetic words
  const tokens = cleaned.split(/\s+/);
  const nameTokens: string[] = [];
  let started = false;
  for (const t of tokens) {
    if (/^[A-Za-z]/.test(t)) { started = true; nameTokens.push(t); }
    else if (started && nameTokens.length >= 2) break;
  }
  return nameTokens.join(" ").replace(/\s+Unit\s+\w+.*$/i, "").replace(/\s+\d{4,}.*$/, "").trim();
}

/**
 * Fuzzy-match a revenue source string to existing client names.
 * Returns the clientId if a match is found, null otherwise.
 */
function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\bcorporation\b/g, "corp")
    .replace(/\bincorporated\b/g, "inc")
    .replace(/\bprivate\b/g, "pvt")
    .replace(/[^a-z0-9]/g, "");
}

function fuzzyMatchClient(source: string, clients: { id: string; name: string; company: string | null }[]): string | null {
  if (!source) return null;
  const cleanSource = normalizeName(extractCleanName(source));
  if (cleanSource.length < 3) return null;

  for (const client of clients) {
    const names = [client.name, client.company]
      .filter(Boolean)
      .map((n) => normalizeName(extractCleanName(n!)))
      .filter((n) => n.length >= 3);
    for (const name of names) {
      if (cleanSource.includes(name) || name.includes(cleanSource)) {
        return client.id;
      }
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // Build date filter for revenue month field
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      const d: Record<string, unknown> = {};
      if (from) d.gte = new Date(from);
      if (to) d.lte = new Date(to + "T23:59:59Z");
      dateFilter.month = d;
    }

    const [revenues, clients] = await Promise.all([
      prisma.revenue.findMany({
        where: { organizationId, ...dateFilter },
        include: { client: true },
        orderBy: { month: "desc" },
        take: 500, // RELIABILITY: Query boundary
      }),
      prisma.client.findMany({
        where: { organizationId },
        select: { id: true, name: true, company: true },
        take: 500, // RELIABILITY: Query boundary
      }),
    ]);

    // ── Auto-detection: tag sources with 2+ distinct months as recurring ──
    // Group by normalized company name (not raw source string)
    const sourceMonths: Record<string, Set<string>> = {};
    const sourceToNormalized: Record<string, string> = {};
    for (const r of revenues) {
      if (!r.source) continue;
      const cleanKey = normalizeName(extractCleanName(r.source));
      if (cleanKey.length < 3) continue;
      sourceToNormalized[r.source] = cleanKey;
      if (!sourceMonths[cleanKey]) sourceMonths[cleanKey] = new Set();
      sourceMonths[cleanKey].add(r.month.toISOString().slice(0, 7));
    }

    // Bulk updates for auto-tagging
    const autoTagUpdates: string[] = [];
    const autoLinkUpdates: { revenueId: string; clientId: string }[] = [];

    for (const r of revenues) {
      // Auto-tag recurring if 2+ distinct months by normalized name and currently not recurring
      const normalizedKey = r.source ? sourceToNormalized[r.source] : undefined;
      if (normalizedKey && r.type !== "recurring" && (sourceMonths[normalizedKey]?.size ?? 0) >= 2) {
        autoTagUpdates.push(r.id);
      }
      // Auto-link to client if not already linked
      if (!r.clientId && r.source) {
        const matchedClientId = fuzzyMatchClient(r.source, clients);
        if (matchedClientId) {
          autoLinkUpdates.push({ revenueId: r.id, clientId: matchedClientId });
        }
      }
    }

    // Apply auto-tag updates
    if (autoTagUpdates.length > 0) {
      await prisma.revenue.updateMany({
        where: { id: { in: autoTagUpdates }, organizationId },
        data: { type: "recurring" },
      });
    }

    // Apply auto-link updates
    for (const { revenueId, clientId } of autoLinkUpdates) {
      await prisma.revenue.update({
        where: { id: revenueId, organizationId },
        data: { clientId },
      });
    }

    // Re-fetch if we made changes
    if (autoTagUpdates.length > 0 || autoLinkUpdates.length > 0) {
      const updatedRevenues = await prisma.revenue.findMany({
        where: { organizationId },
        include: { client: true },
        orderBy: { month: "desc" },
        take: 500, // RELIABILITY: Query boundary
      });
      return NextResponse.json({
        revenues: updatedRevenues,
        autoTagged: autoTagUpdates.length,
        autoLinked: autoLinkUpdates.length,
      });
    }

    return NextResponse.json({ revenues, autoTagged: 0, autoLinked: 0 });
  } catch (error) {
    log.error("List revenue error", { module: "revenue", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to list revenue" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 15, prefix: "revenue" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const raw = await request.json();
    const result = CreateRevenueSchema.safeParse(raw);

    if (!result.success) {
      return NextResponse.json({ error: "Invalid payload", details: result.error.issues }, { status: 400 });
    }

    const { month, amount, type, source, notes, clientId, category } = result.data;

    const revenue = await prisma.revenue.create({
      data: {
        userId,
        organizationId,
        month: new Date(month),
        amount,
        type: type || "recurring",
        category: category || undefined,
        source,
        notes,
        clientId: clientId || undefined,
      },
      include: { client: true },
    });

    logAudit({ userId, action: "create", resource: "revenue", resourceId: revenue.id, details: { amount, type: type || "recurring", source } });
    return NextResponse.json({ revenue }, { status: 201 });
  } catch (error) {
    log.error("Create revenue error", { module: "revenue", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create revenue" }, { status: 500 });
  }
}

/**
 * PATCH /api/revenue — Bulk update revenue entries by source
 * Body: { source: string, type?: "recurring" | "one-time", clientId?: string | null }
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const body = await request.json();
    const { source, type, clientId } = body;

    if (!source) {
      return NextResponse.json({ error: "source is required" }, { status: 400 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (type !== undefined) updateData.type = type;
    if (clientId !== undefined) updateData.clientId = clientId;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const result = await prisma.revenue.updateMany({
      where: { organizationId, source },
      data: updateData,
    });

    logAudit({ userId, action: "update", resource: "revenue", details: { source, updatedCount: result.count, ...updateData } });
    return NextResponse.json({ updated: result.count });
  } catch (error) {
    log.error("Patch revenue error", { module: "revenue", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to update revenue" }, { status: 500 });
  }
}

