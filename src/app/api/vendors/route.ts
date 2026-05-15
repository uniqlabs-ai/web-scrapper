import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { CreateVendorSchema } from "@/lib/schemas";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/vendors — List vendors with spending totals
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const vendors = await prisma.vendor.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: 500, // RELIABILITY: Query boundary
      include: {
        _count: { select: { expenses: true } },
      },
    });

    // Build date filter for expense queries
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      dateFilter.date = {};
      if (from) (dateFilter.date as Record<string, unknown>).gte = new Date(from);
      if (to) (dateFilter.date as Record<string, unknown>).lte = new Date(to + "T23:59:59Z");
    }

    // Get spending totals per vendor (filtered by date)
    const vendorIds = vendors.map((v) => v.id);
    const spending = await prisma.expense.groupBy({
      by: ["vendorId"],
      where: { vendorId: { in: vendorIds }, ...dateFilter },
      _sum: { amount: true },
      _count: true,
    });

    const spendMap = new Map(
      spending.map((s) => [s.vendorId, { total: Number(s._sum.amount ?? 0), count: s._count }])
    );

    return NextResponse.json({
      vendors: vendors.map((v) => {
        const spend = spendMap.get(v.id);
        return {
          id: v.id,
          name: v.name,
          email: v.email,
          phone: v.phone,
          company: v.company,
          gstNumber: v.gstNumber,
          panNumber: v.panNumber,
          paymentTerms: v.paymentTerms,
          isActive: v.isActive,
          totalSpent: spend?.total || 0,
          expenseCount: spend?.count || v._count.expenses,
          createdAt: v.createdAt.toISOString(),
        };
      }),
    });
  } catch (error) {
    log.error("List vendors error", { module: "vendors", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 });
  }
}

/**
 * POST /api/vendors — Create a vendor
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 20, prefix: "vendors" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const raw = await request.json();
    const result = CreateVendorSchema.safeParse(raw);

    if (!result.success) {
      return NextResponse.json({ error: "Invalid payload", details: result.error.issues }, { status: 400 });
    }

    const { name, email, phone, company, gstNumber, panNumber, bankName, bankAccount, bankIfsc, paymentTerms, address, notes } = result.data;

    const vendor = await prisma.vendor.create({
      data: {
        name,
        email,
        phone,
        company,
        gstNumber,
        panNumber,
        bankName,
        bankAccount,
        bankIfsc,
        paymentTerms: paymentTerms || 30,
        address,
        notes,
        userId,
        organizationId,
      },
    });

    // Auto-link existing expenses whose description contains this vendor name
    if (name && name.length >= 3) {
      const linked = await prisma.expense.updateMany({
        where: {
          userId,
          organizationId,
          vendorId: null,
          description: { contains: name, mode: "insensitive" },
        },
        data: { vendorId: vendor.id },
      });
      log.info("Linked expenses to vendor", { module: "vendors", action: "create", meta: { linkedCount: linked.count, vendorName: name } });

      // Also try matching the vendor field on expenses
      await prisma.expense.updateMany({
        where: {
          userId,
          organizationId,
          vendorId: null,
          vendor: { contains: name, mode: "insensitive" },
        },
        data: { vendorId: vendor.id },
      });
    }

    logAudit({ userId, action: "create", resource: "vendor", resourceId: vendor.id, details: { name: vendor.name } });
    return NextResponse.json(vendor, { status: 201 });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Vendor with this name already exists" }, { status: 409 });
    }
    log.error("Create vendor error", { module: "vendors", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create vendor" }, { status: 500 });
  }
}

/**
 * PATCH /api/vendors — Update a vendor, or relink expenses
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const body = await request.json();

    // Relink mode: scan all vendors and link matching expenses
    if (body.relink) {
      const vendors = await prisma.vendor.findMany({ where: { organizationId }, take: 500 });
      let totalLinked = 0;
      for (const v of vendors) {
        if (v.name.length < 3) continue;
        const r1 = await prisma.expense.updateMany({
          where: {
            userId,
            vendorId: null,
            description: { contains: v.name, mode: "insensitive" },
          },
          data: { vendorId: v.id },
        });
        const r2 = await prisma.expense.updateMany({
          where: {
            userId,
            vendorId: null,
            vendor: { contains: v.name, mode: "insensitive" },
          },
          data: { vendorId: v.id },
        });
        totalLinked += r1.count + r2.count;
      }
      return NextResponse.json({ success: true, linked: totalLinked });
    }

    // Normal update
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    const vendor = await prisma.vendor.update({
      where: { id },
      data,
    });

    return NextResponse.json(vendor);
  } catch (error) {
    log.error("Update vendor error", { module: "vendors", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to update vendor" }, { status: 500 });
  }
}

/**
 * DELETE /api/vendors — Delete a vendor
 */
export async function DELETE(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    // Verify vendor belongs to this organization
    const vendor = await prisma.vendor.findFirst({ where: { id, organizationId } });
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    await prisma.vendor.delete({ where: { id } });
    logAudit({ userId, action: "delete", resource: "vendor", resourceId: id, details: { name: vendor.name } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete vendor error", { module: "vendors", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to delete vendor" }, { status: 500 });
  }
}
