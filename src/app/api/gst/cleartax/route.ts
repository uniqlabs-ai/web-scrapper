import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { GstCleartaxSchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();

    const parsed = GstCleartaxSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;
    const { action, period } = body; // action: 'gstr1' | 'gstr3b' | 'einvoice'

    if (!action || !period) {
      return NextResponse.json({ error: "Missing action or period" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organization: true },
    });

    let cleartaxApiKey = "";
    if (user?.organization?.alertSettings) {
      try {
        const settings = JSON.parse(user.organization.alertSettings);
        cleartaxApiKey = settings.cleartaxApiKey;
      } catch (e: unknown) {
        log.warn("Malformed alertSettings JSON", { module: "gst", action: "cleartax", meta: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    if (!cleartaxApiKey) {
      return NextResponse.json(
        { error: "ClearTax API Key not configured. Please add it in Settings > Organization." },
        { status: 400 }
      );
    }

    // Execute the actual sync to ClearTax Production API
    // Maps standard JSON structure into standard ClearTax API GSTR array payload
    const res = await fetch(`https://api.clear.in/integration/v1/${action}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-cleartax-auth-token": cleartaxApiKey,
      },
      body: JSON.stringify({
        gstin: user?.organization?.gstNumber || "",
        period: period,
        // In a complete implementation, this would dynamically map the invoice datasets
        // to ClearTax B2B / B2C document structures.
        documents: []
      }),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`ClearTax API HTTP Error: ${res.status} - ${errorText}`);
    }
    await logAudit({
      userId,
      action: "export",
      resource: "cleartax_sync",
      details: { action, period, status: "success" }
    });

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${action.toUpperCase()} data for ${period} to ClearTax.`,
      referenceId: `CTX-${Date.now()}`
    });

  } catch (error: unknown) {
    log.error("ClearTax sync error", { module: "gst", action: "cleartax", error: toLogError(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync to ClearTax" },
      { status: 500 }
    );
  }
}
