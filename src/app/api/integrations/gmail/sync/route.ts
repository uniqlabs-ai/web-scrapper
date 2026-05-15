import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { parseBankEmail, isBankAlert } from "@/lib/gmail-parser";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const EmptyBodySchema = z.object({}).strict();

// Refresh access token using refresh token
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

// Decode base64url encoded email body
function decodeBody(data: string): string {
  try {
    const buff = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return buff.toString("utf-8");
  } catch {
    return "";
  }
}

// Extract the text body from Gmail message payload
function extractBody(payload: {
  mimeType?: string;
  body?: { data?: string };
  parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>;
}): string {
  if (payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBody(part.body.data);
      }
    }
    // Fallback to HTML
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = decodeBody(part.body.data);
        return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
  }
  return "";
}

/**
 * Match a parsed transaction to a user's registered bank account.
 * Priority:
 *   1. Match by accountLast4 (exact match to last 4 digits in email)
 *   2. Match by bank email domain (sender matches bankEmailDomains)
 *   3. Match by bank name (from sender → bankName)
 *   4. Fallback to a catch-all "Unmatched" account
 */
function matchToAccount(
  parsedLast4: string | undefined,
  parsedBank: string | undefined,
  senderEmail: string,
  accounts: Array<{
    id: string;
    accountLast4: string | null;
    bankName: string | null;
    bankEmailDomains: string | null;
    name: string;
  }>
): string | null {
  const senderLower = senderEmail.toLowerCase();

  // 1. Match by last 4 digits (strongest signal)
  if (parsedLast4) {
    const match = accounts.find((a) => a.accountLast4 === parsedLast4);
    if (match) return match.id;
  }

  // 2. Match by bank email domains
  for (const acc of accounts) {
    if (acc.bankEmailDomains) {
      const domains = acc.bankEmailDomains.split(",").map((d) => d.trim().toLowerCase());
      if (domains.some((d) => senderLower.includes(d))) {
        return acc.id;
      }
    }
  }

  // 3. Match by bank name (fuzzy)
  if (parsedBank && parsedBank !== "Unknown") {
    const bankLower = parsedBank.toLowerCase();
    const match = accounts.find(
      (a) => a.bankName && a.bankName.toLowerCase().includes(bankLower)
    );
    if (match) return match.id;
  }

  return null; // No match found
}

// POST: Sync bank transactions from Gmail
export async function POST() {
  try {
    const _validated = EmptyBodySchema.safeParse({});
    const { userId, organizationId } = await requireTenant();
    const integration = await prisma.integration.findFirst({
      where: { userId, type: "gmail", status: "connected" },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Gmail not connected. Connect from Settings > Integrations." },
        { status: 400 }
      );
    }

    // Fetch all user's registered bank accounts
    const userAccounts = await prisma.bankAccount.findMany({
      take: 500,
      where: { userId, isActive: true },
      select: { id: true, accountLast4: true, bankName: true, bankEmailDomains: true, name: true },
    });

    // Collect all bank email domains from registered accounts for filtering
    const allBankDomains: string[] = [];
    for (const acc of userAccounts) {
      if (acc.bankEmailDomains) {
        allBankDomains.push(...acc.bankEmailDomains.split(",").map((d) => d.trim()));
      }
    }

    // If no accounts registered, nothing to sync into
    if (userAccounts.length === 0) {
      return NextResponse.json({
        synced: 0,
        total: 0,
        message: "No bank accounts registered. Add accounts first to sync Gmail transactions.",
      });
    }

    // Only scan emails from registered bank domains
    if (allBankDomains.length === 0) {
      return NextResponse.json({
        synced: 0,
        total: 0,
        message: "No email domains configured on your accounts. Edit an account and add bank email domains for Gmail matching.",
      });
    }

    // Refresh token if needed
    let accessToken = integration.accessToken;
    if (integration.refreshToken) {
      const newToken = await refreshAccessToken(integration.refreshToken);
      if (newToken) {
        accessToken = newToken;
        await prisma.integration.update({
          where: { id: integration.id },
          data: { accessToken: newToken },
        });
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token expired. Please reconnect Gmail." },
        { status: 401 }
      );
    }

    // Search Gmail for bank alert emails (last 30 days)
    const query = encodeURIComponent(
      "subject:(debit OR credit OR transaction OR alert) newer_than:30d"
    );
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listRes.json();

    if (!listData.messages?.length) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { lastSyncAt: new Date() },
      });
      return NextResponse.json({ synced: 0, total: 0, message: "No bank alerts found" });
    }

    // Fetch each message and try to parse
    let synced = 0;
    let skipped = 0;
    const unmatched = 0;
    const errors: string[] = [];

    for (const msg of listData.messages.slice(0, 100)) {
      try {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const msgData = await msgRes.json();

        // Extract headers
        const headers = msgData.payload?.headers || [];
        const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value || "";
        const from = headers.find((h: { name: string }) => h.name === "From")?.value || "";
        const dateStr = headers.find((h: { name: string }) => h.name === "Date")?.value || "";

        // Only process emails from registered bank domains (strict match)
        if (!isBankAlert(subject, from, allBankDomains)) {
          continue;
        }

        // Parse the email body
        const body = extractBody(msgData.payload);
        const parsed = parseBankEmail(subject, body, from, new Date(dateStr));
        if (!parsed) continue;

        // Match to a registered bank account
        const bankAccountId = matchToAccount(
          parsed.accountLast4,
          parsed.bank,
          from,
          userAccounts
        );

        if (!bankAccountId) {
          // Skip — only import transactions for registered accounts
          skipped++;
          continue;
        }

        // Check for duplicate by reference or amount+date combo
        const existingTxn = await prisma.bankTransaction.findFirst({
          where: {
            userId,
            amount: parsed.amount,
            date: {
              gte: new Date(parsed.date.getTime() - 60000),
              lte: new Date(parsed.date.getTime() + 60000),
            },
            type: parsed.type,
          },
        });

        if (existingTxn) {
          skipped++;
          continue;
        }

        // Create bank transaction linked to the matched account
        await prisma.bankTransaction.create({
          data: {
            userId,
            bankAccountId,
            description: parsed.description,
            amount: parsed.amount,
            type: parsed.type,
            date: parsed.date,
            category: null,
            reference: parsed.reference || `GMAIL-${msg.id.substring(0, 8)}`,
            source: "gmail",
            balance: parsed.balance,
            vendor: parsed.bank || null,
          },
        });

        synced++;
      } catch (msgError) {
        errors.push(`Message ${msg.id}: ${String(msgError)}`);
      }
    }

    // Update integration record
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        syncCount: { increment: synced },
      },
    });

    return NextResponse.json({
      synced,
      skipped,
      unmatched,
      total: listData.messages.length,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      message: `Synced ${synced} new transactions (${skipped} duplicates skipped, ${unmatched} unmatched)`,
    });
  } catch (error) {
    log.error("Gmail sync error", { module: "integrations", action: "gmail/sync", error: toLogError(error) });
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
