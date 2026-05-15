import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { log, toLogError } from "@/lib/logger";
import { RazorpayWebhookSchema } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const bodyText = await req.text();
    const signature = req.headers.get("x-razorpay-signature");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      log.error("RAZORPAY_WEBHOOK_SECRET not configured", { module: "billing", action: "webhook" });
      return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(bodyText)
      .digest("hex");

    // Timing-safe HMAC comparison
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expectedSignature, "hex");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    let rawEvent;
    try {
      rawEvent = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = RazorpayWebhookSchema.safeParse(rawEvent);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }

    const event = parsed.data;

    // Handle payment capture
    if (event.event === "payment.captured" && event.payload) {
      const payment = event.payload.payment.entity;
      const paymentId = payment.id;
      const organizationId = payment.notes?.organizationId;
      const planId = payment.notes?.planId;

      if (organizationId && planId) {
        // RELIABILITY: Idempotency — check if this payment was already processed
        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { planTier: true, razorpayId: true }
        });
        
        if (org?.razorpayId === paymentId) {
            log.info("Duplicate payment skipped", { module: "billing", action: "webhook", meta: { paymentId, organizationId } });
          return NextResponse.json({ status: "ok", duplicate: true });
        }

        // Use upsert-like pattern to handle race conditions
        await prisma.organization.update({
          where: { id: organizationId },
          data: {
            planTier: planId,
            razorpayId: paymentId,
          },
        });
        log.info("Plan upgraded via Razorpay", { module: "billing", action: "webhook", orgId: organizationId, meta: { planId, paymentId } });
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    log.error("Razorpay webhook processing failed", { module: "billing", action: "webhook", error: toLogError(error) });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
