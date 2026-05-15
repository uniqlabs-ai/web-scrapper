import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";

/**
 * SHA-256 hash an API key for storage/comparison.
 * Raw keys are NEVER stored — only their hashes.
 */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Generate a new API key pair: raw (shown once to user) + hash (stored in DB).
 */
export function generateApiKey(prefix = "fos_sk"): { raw: string; hash: string } {
  const raw = `${prefix}_${randomBytes(32).toString("hex")}`;
  return { raw, hash: hashApiKey(raw) };
}

/**
 * Validates a Bearer token (API Key) from the request headers.
 * Hashes the incoming key and compares against the stored hash.
 * Returns the organizationId if valid, null otherwise.
 */
export async function validateApiKey(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const rawKey = authHeader.split(" ")[1];
  const keyHash = hashApiKey(rawKey);

  const validKey = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!validKey) {
    return null;
  }

  // Update last used asynchronously (fire-and-forget)
  prisma.apiKey.update({
    where: { id: validKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(String);

  return validKey.organizationId;
}

