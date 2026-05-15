import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { UpdateOrganizationSettingsSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const org = await prisma.organization.findFirst({
      where: { users: { some: { id: userId } } },
    });

    return NextResponse.json({
      organization: org || {
        name: "",
        currency: "INR",
        gstNumber: "",
        address: "",
        logoUrl: "",
        alertSettings: JSON.stringify({ runwayWarningMonths: 3, budgetAlertThreshold: 0.8 }),
      },
      hasResend: !!process.env.RESEND_API_KEY,
    });
  } catch (error) {
    log.error("Get org settings error", { module: "settings", action: "organization", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 10, prefix: "settings-org" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();

    const parsed = UpdateOrganizationSettingsSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;
    const { name, currency, gstNumber, address, logoUrl, alertSettings, cashInBank } = body;

    let org = await prisma.organization.findFirst({
      where: { users: { some: { id: userId } } },
    });

    if (org) {
      org = await prisma.organization.update({
        where: { id: org.id },
        data: {
          name: name ?? org.name,
          currency: currency ?? org.currency,
          gstNumber: gstNumber !== undefined ? gstNumber : org.gstNumber,
          address: address !== undefined ? address : org.address,
          logoUrl: logoUrl !== undefined ? logoUrl : org.logoUrl,
          alertSettings: alertSettings !== undefined
            ? (typeof alertSettings === "string" ? alertSettings : JSON.stringify(alertSettings))
            : org.alertSettings,
          cashInBank: cashInBank !== undefined ? cashInBank : org.cashInBank,
        },
      });
    } else {
      org = await prisma.organization.create({
        data: {
          name: name || "My Company",
          currency: currency || "INR",
          gstNumber,
          address,
          logoUrl,
          alertSettings: alertSettings
            ? (typeof alertSettings === "string" ? alertSettings : JSON.stringify(alertSettings))
            : JSON.stringify({ runwayWarningMonths: 3, budgetAlertThreshold: 0.8 }),
          users: { connect: { id: userId } },
        },
      });
    }

    logAudit({ userId, action: "update", resource: "organization", resourceId: org.id, details: { name: org.name, currency: org.currency } });
    return NextResponse.json({ organization: org });
  } catch (error) {
    log.error("Update org settings error", { module: "settings", action: "organization", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
