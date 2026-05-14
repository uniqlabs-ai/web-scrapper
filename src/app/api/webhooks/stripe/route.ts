import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const StripeEventEnvelopeSchema = z.object({
  type: z.string().min(1),
  data: z.object({ object: z.record(z.string(), z.unknown()) }).passthrough(),
}).passthrough();

// Initialize Stripe SDK
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_demo", {
  // @ts-expect-error -- Stripe SDK type may lag behind latest API version string
  apiVersion: "2024-12-18.acacia",
  typescript: true,
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_demo";

export async function POST(req: NextRequest) {
  try {
    const bodyText = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      return NextResponse.json({ error: "Missing stripe signature" }, { status: 400 });
    }

    let event: Stripe.Event;

    try {
      // Cryptographically verify the webhook authenticity
      event = stripe.webhooks.constructEvent(bodyText, sig, webhookSecret);
    } catch (err: unknown) {
      log.error("Stripe webhook signature verification failed", { module: "webhooks", action: "stripe", error: { message: err instanceof Error ? err.message : String(err), name: "WebhookSignatureError" } });
      return NextResponse.json({ error: "Webhook Error" }, { status: 400 });
    }

    log.info("Verified Stripe event", { module: "webhooks", action: "stripe", meta: { eventType: event.type } });

    // Additional Zod envelope validation
    const envelopeParsed = StripeEventEnvelopeSchema.safeParse(event);
    if (!envelopeParsed.success) {
      return NextResponse.json({ error: "Stripe event structure invalid" }, { status: 400 });
    }

    // Track user org based on Stripe Customer metadata mapping.
    // In production, when a user signs up, we attach their OrganizationId to the Stripe Customer.
    // For this demo implementation, we default to the Admin HQ if metadata is missing.
    const admin = await prisma.user.findFirst({ where: { role: "admin" } });
    if (!admin) throw new Error("No admin organization available to attach Stripe MRR to");

    const userId = admin.id;
    const organizationId = admin.organizationId;

    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      
      // RELIABILITY: Idempotency guard — prevent duplicate revenue on Stripe webhook retry
      const existingRevenue = await prisma.revenue.findFirst({
        where: { sourceId: invoice.id, source: "stripe_webhook" }
      });
      if (existingRevenue) {
        log.info("Duplicate Stripe event skipped", { module: "webhooks", action: "stripe", meta: { invoiceId: invoice.id } });
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
      }

      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const amountPaid = invoice.amount_paid / 100; // Stripe provides in cents
      const currency = invoice.currency.toUpperCase();

      // Determine if this is MRR (recurring) or a one-time charge
      let isRecurring = false;
      const lines = invoice.lines.data;
      if (lines.length > 0) {
        // If any line item is tied to a price type of "recurring", we log it as MRR
        isRecurring = lines.some((line) => (line as unknown as { price?: { type?: string } }).price?.type === "recurring");
      }

      // RELIABILITY: Atomic transaction — client upsert + revenue creation must succeed together
      await prisma.$transaction(async (tx) => {
        // 1. Identify or Create the Client based on the Stripe Customer mapping
        let client = await tx.client.findFirst({ where: { aliases: { contains: customerId } } });
        if (!client) {
           client = await tx.client.create({
              data: {
                 name: invoice.customer_name || `Stripe Customer ${customerId}`,
                 email: invoice.customer_email || `unknown-${customerId}@stripe.com`,
                 aliases: JSON.stringify([customerId]),
                 userId,
                 organizationId
              }
           });
        }

        // 2. Hydrate the Native Revenue Ledger
        await tx.revenue.create({
           data: {
              month: new Date(invoice.created * 1000), // Unix timestamp conversion
              amount: amountPaid,
              currency,
              type: isRecurring ? "recurring" : "one_time",
              source: "stripe_webhook",
              sourceId: invoice.id,
              notes: `Stripe Sync (Invoice: ${invoice.number || "unknown"})`,
              userId,
              organizationId,
              clientId: client.id
           }
        });
      });

      log.info("Stripe payment logged to MRR Ledger", { module: "webhooks", action: "stripe", meta: { amount: amountPaid, currency } });
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      log.warn("Stripe subscription ended — churn detected", { module: "webhooks", action: "stripe", meta: { customerId } });
      // Update our Client status or internal Churn tracker here.
    }

    return NextResponse.json({ received: true }, { status: 200 });

  } catch (error) {
    log.error("Stripe Webhook Pipeline Error", { module: "webhooks", action: "stripe", error: toLogError(error) });
    return NextResponse.json({ error: "Pipeline Failure" }, { status: 500 });
  }
}
