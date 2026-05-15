import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import Razorpay from "razorpay";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const CheckoutRequestSchema = z.object({
  planId: z.enum(["starter", "professional", "enterprise"]),
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_demo",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "demo_secret",
});

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(req, { windowSec: 60, max: 5, prefix: "billing" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await req.json();
    const parsed = CheckoutRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { planId } = parsed.data;

    const org = await prisma.organization.findFirst({
      where: { users: { some: { id: userId } } },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Default to INR currency for Razorpay India
    // Create an order for a flat Setup/SaaS fee (simplification for B2B)
    const amount = planId === "enterprise" ? 5000000 : 990000; // ₹50,000 or ₹9,900 (in paise)

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `receipt_${org.id.substring(0, 10)}`,
      notes: {
        organizationId: org.id,
        planId,
      },
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      organizationId: org.id,
    });
  } catch (error) {
    log.error("Razorpay order creation failed", { module: "billing", action: "checkout", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
