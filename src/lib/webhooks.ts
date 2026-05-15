import { prisma } from "./prisma";
import crypto from "crypto";
import { log, toLogError } from "./logger";

/**
 * Create an HMAC-SHA256 signature for a webhook payload.
 * Returns empty string if no secret is available (webhook will be skipped).
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Fires an event to all registered and active webhooks for a specific tenant organization.
 */
export async function fireWebhook(organizationId: string, eventName: string, payload: Record<string, unknown>) {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      take: 100, // RELIABILITY: Safety ceiling
    });

    if (webhooks.length === 0) return;

    // Filter webhooks that listen to this specific event (or wildcard "*")
    const targets = webhooks.filter(wh => {
      try {
        const parsedEvents = JSON.parse(wh.events);
        return Array.isArray(parsedEvents) && (parsedEvents.includes(eventName) || parsedEvents.includes("*"));
      } catch {
        return false;
      }
    });

    if (targets.length === 0) return;

    const payloadString = JSON.stringify({
      event: eventName,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    // Fire asynchronously
    Promise.allSettled(targets.map(async (webhook) => {
      // Require a real secret — skip webhooks with no secret configured
      const secret = webhook.secret || process.env.WEBHOOK_SECRET;
      if (!secret) {
        log.warn("Webhook skipped — no secret configured", { module: "webhooks", action: "fire", meta: { url: webhook.url, event: eventName } });
        return;
      }

      try {
        await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Finance-Event": eventName,
            "X-Finance-Signature": signPayload(payloadString, secret),
          },
          body: payloadString,
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        log.error("Webhook dispatch failed", { module: "webhooks", action: "fire", meta: { url: webhook.url, event: eventName }, error: toLogError(err) });
      }
    }));
    
  } catch (error) {
    log.error("Webhook dispatcher error", { module: "webhooks", action: "dispatch", meta: { organizationId }, error: toLogError(error) });
  }
}

/**
 * Verify an inbound HMAC-SHA256 webhook signature using timing-safe comparison.
 * Fail-closed: returns false if secret is missing.
 */
export function verifyWebhookSignature(body: string, signature: string, secret?: string): boolean {
  const effectiveSecret = secret || process.env.WEBHOOK_SECRET;
  if (!effectiveSecret) return false; // Fail-closed

  const expected = crypto.createHmac("sha256", effectiveSecret).update(body).digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");

  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}
