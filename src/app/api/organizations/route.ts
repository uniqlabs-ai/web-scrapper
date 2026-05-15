import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const OrgSchema = z.object({
  name: z.string().min(1, "Name required").max(200),
  currency: z.string().min(3).max(3).default("INR"),
  gstNumber: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
});

// List all organizations the current user belongs to
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    // Get current org + any other orgs user has access to
    const organizations = await prisma.organization.findMany({
      take: 500,
      where: {
        users: { some: { id: userId } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      organizations,
      activeOrgId: user?.organizationId || null,
    });
  } catch (error) {
    log.error("List orgs error", { module: "organizations", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to list organizations" }, { status: 500 });
  }
}

// Create a new organization
export async function POST(request: Request) {
  try {
    const limited = rateLimit(request as NextRequest, { windowSec: 60, max: 5, prefix: "organizations" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = OrgSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { name, currency, gstNumber, address } = parsed.data;

    const org = await prisma.organization.create({
      data: {
        name: name.trim(),
        currency,
        gstNumber,
        address,
        users: { connect: { id: userId } },
      },
    });

    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (error) {
    log.error("Create org error", { module: "organizations", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create organization" }, { status: 500 });
  }
}
