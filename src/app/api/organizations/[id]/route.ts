import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { UpdateOrganizationSettingsSchema } from "@/lib/schemas";

// Update organization details
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const guard = await requirePermission("write");
    if (!guard.allowed) return guard.response;
    const { userId, organizationId } = guard;
    const rawBody = await request.json();

    const parsed = UpdateOrganizationSettingsSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;

    // Verify access
    const org = await prisma.organization.findFirst({
      where: { id, users: { some: { id: userId } } },
    });
    if (!org) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { name, currency, gstNumber, address, cashInBank, alertSettings } = body;
    const updated = await prisma.organization.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(currency && { currency }),
        ...(gstNumber !== undefined && { gstNumber }),
        ...(address !== undefined && { address }),
        ...(cashInBank !== undefined && { cashInBank }),
        ...(alertSettings !== undefined && { alertSettings }),
      },
    });

    return NextResponse.json({ organization: updated });
  } catch (error) {
    log.error("Update org error", { module: "organizations", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 });
  }
}

// Delete organization
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const guard = await requirePermission("manage_users");
    if (!guard.allowed) return guard.response;
    const { userId } = guard;

    // Verify access and prevent deleting last org
    const userOrgs = await prisma.organization.findMany({
      take: 500,
      where: { users: { some: { id: userId } } },
    });

    if (userOrgs.length <= 1) {
      return NextResponse.json({ error: "Cannot delete your only organization" }, { status: 400 });
    }

    await prisma.organization.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete org error", { module: "organizations", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to delete organization" }, { status: 500 });
  }
}
