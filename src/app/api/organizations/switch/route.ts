import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { SwitchOrganizationSchema } from "@/lib/schemas";

// Switch active organization for the user
export async function POST(request: NextRequest) {
  try {
    const { userId, organizationId: _currentOrgId } = await requireTenant();
    const rawBody = await request.json();

    const parsed = SwitchOrganizationSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;
    const { organizationId } = body;
    // organizationId is guaranteed by Zod schema (z.string().min(1))

    // Verify user has access to this org
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId,
        users: { some: { id: userId } },
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found or access denied" }, { status: 404 });
    }

    // Update user's active org
    await prisma.user.update({
      where: { id: userId },
      data: { organizationId },
    });

    return NextResponse.json({ success: true, organization: org });
  } catch (error) {
    log.error("Switch org error", { module: "organizations", action: "switch", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to switch organization" }, { status: 500 });
  }
}
