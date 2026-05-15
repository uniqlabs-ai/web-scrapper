import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/webhooks";
import { log, toLogError } from "@/lib/logger";
import { InboundWebhookEventSchema } from "@/lib/schemas";

interface InboundEvent {
  productId: string;
  event: string;
  summary: string;
  data: Record<string, unknown>;
  timestamp: string;
}




async function processEvent(event: InboundEvent) {
  const { productId, event: eventType, data } = event;

  // Resolve organizationId from the source user for tenant scoping
  const sourceUserId = (data.userId as string) || "demo-user";
  const sourceUser = await prisma.user.findUnique({
    where: { id: sourceUserId },
    select: { organizationId: true },
  });
  const organizationId = sourceUser?.organizationId || undefined;

  // Auto-create expenses from other modules
  if (eventType === "offer.accepted" && productId === "hiring") {
    const salary = (data.salary as number) || 0;
    const candidateName = (data.candidateName as string) || "New Hire";
    const userId = sourceUserId;

    // RELIABILITY: Idempotency guard — prevent duplicate expenses on webhook retry
    const existingExpense = await prisma.expense.findFirst({
      where: { sourceId: data.offerId as string, source: `${productId}.${eventType}` }
    });
    if (existingExpense) {
      log.info("Duplicate hiring event skipped", { module: "webhooks", action: "inbound", meta: { offerId: data.offerId } });
      return { action: "duplicate.skipped", existingId: existingExpense.id };
    }

    await prisma.expense.create({
      data: {
        userId,
        organizationId,
        description: `Hiring: ${candidateName} (annual salary)`,
        amount: salary,
        date: new Date(),
        vendor: "Internal",
        source: `${productId}.${eventType}`,
        sourceId: data.offerId as string,
        department: "hr",
        isRecurring: true,
      },
    });

    return { action: "expense.created", amount: salary };
  }

  if (eventType === "deal.closed" && productId === "uniqlabs") {
    const amount = (data.dealValue as number) || 0;
    const _clientName = (data.clientName as string) || "Client";
    const userId = sourceUserId;

    // RELIABILITY: Idempotency guard
    const existingRevenue = await prisma.revenue.findFirst({
      where: { sourceId: data.dealId as string, source: `${productId}.${eventType}` }
    });
    if (existingRevenue) {
      return { action: "duplicate.skipped", existingId: existingRevenue.id };
    }

    await prisma.revenue.create({
      data: {
        userId,
        organizationId,
        month: new Date(),
        amount,
        type: (data.recurring as boolean) ? "recurring" : "one-time",
        source: `${productId}.${eventType}`,
        sourceId: data.dealId as string,
      },
    });

    return { action: "revenue.created", amount };
  }

  if (eventType === "campaign.launched" && productId === "gtm") {
    const budget = (data.budget as number) || 0;
    const campaignName = (data.campaignName as string) || "Marketing Campaign";
    const userId = sourceUserId;

    // RELIABILITY: Idempotency guard
    const existingExpense = await prisma.expense.findFirst({
      where: { sourceId: data.campaignId as string, source: `${productId}.${eventType}` }
    });
    if (existingExpense) {
      return { action: "duplicate.skipped", existingId: existingExpense.id };
    }

    await prisma.expense.create({
      data: {
        userId,
        organizationId,
        description: `Campaign: ${campaignName}`,
        amount: budget,
        date: new Date(),
        vendor: (data.platform as string) || "Marketing",
        source: `${productId}.${eventType}`,
        sourceId: data.campaignId as string,
        department: "marketing",
      },
    });

    return { action: "expense.created", amount: budget };
  }

  if (eventType === "subscription.renewed") {
    const amount = (data.amount as number) || 0;
    const userId = sourceUserId;

    // RELIABILITY: Idempotency guard
    const existingRevenue = await prisma.revenue.findFirst({
      where: { sourceId: data.subscriptionId as string, source: `${productId}.${eventType}` }
    });
    if (existingRevenue) {
      return { action: "duplicate.skipped", existingId: existingRevenue.id };
    }

    await prisma.revenue.create({
      data: {
        userId,
        organizationId,
        month: new Date(),
        amount,
        type: "recurring",
        source: `${productId}.${eventType}`,
        sourceId: data.subscriptionId as string,
      },
    });

    return { action: "revenue.created", amount };
  }

  return { action: "event.logged", note: "No automatic processing for this event type" };
}

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text();

    // Verify HMAC signature (timing-safe, fail-closed)
    const signature = request.headers.get("x-webhook-signature") || "";
    if (!verifyWebhookSignature(bodyText, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let rawEvent;
    try {
      rawEvent = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = InboundWebhookEventSchema.safeParse(rawEvent);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }

    const event: InboundEvent = parsed.data;

    const result = await processEvent(event);

    return NextResponse.json({
      received: true,
      processed: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error("Inbound webhook error", { module: "webhooks", action: "inbound", error: toLogError(error) });
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}
