import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission, logActivity, Role } from "@/lib/rbac";
import { log, toLogError } from "@/lib/logger";
import { UpdateUserRoleSchema } from "@/lib/schemas";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const check = await checkPermission("manage_users");
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id } = await params;
    const rawBody = await request.json();

    const parsed = UpdateUserRoleSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const body = parsed.data;

    const validRoles: Role[] = ["admin", "accountant", "viewer", "approver", "custom"];
    if (body.role && !validRoles.includes(body.role as Role)) {
      return NextResponse.json({ error: `Invalid role` }, { status: 400 });
    }

    const updateData: { fullName?: string; role?: string; permissions?: string | null } = {
      ...(body.fullName && { fullName: body.fullName as string }),
      ...(body.role && { role: body.role as string }),
      ...(body.permissions !== undefined && {
        permissions: body.permissions === null ? null : JSON.stringify(body.permissions),
      }),
    };

    // Verify target user belongs to caller's org
    const target = await prisma.user.findFirst({
      where: { id, organizationId: check.user.organizationId },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found in your organization" }, { status: 404 });
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
    });

    await logActivity(check.user.id, "updated", "user", id, { role: body.role });

    return NextResponse.json({ user });
  } catch (error: unknown) {
    log.error("Update user error", { module: "users", action: "handler", error: toLogError(error) });
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2025") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
