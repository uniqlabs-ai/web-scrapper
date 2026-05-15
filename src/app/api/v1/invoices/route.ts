import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-auth";
import { fireWebhook } from "@/lib/webhooks";
import { log, toLogError } from "@/lib/logger";
import { V1CreateInvoiceSchema } from "@/lib/schemas";

// GET /api/v1/invoices - Fetch invoices programmatically
export async function GET(req: NextRequest) {
  const organizationId = await validateApiKey(req);
  if (!organizationId) {
    return NextResponse.json({ error: "Unauthorized. Invalid or missing API Key" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const invoices = await prisma.invoice.findMany({
      take: 500,
    where: {
      organizationId,
      ...(status ? { status } : {})
    },
    include: {
      client: {
        select: { id: true, name: true, email: true }
      }
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ invoices });
}

// POST /api/v1/invoices - Create invoice programmatically originating from external CRM
export async function POST(req: NextRequest) {
  const organizationId = await validateApiKey(req);
  if (!organizationId) {
    return NextResponse.json({ error: "Unauthorized. Invalid API Key" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = V1CreateInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { dueDate, notes, lineItems, clientId, isInterState } = parsed.data;

    // Ensure client exists in that org if provided
    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, organizationId }
      });
      if (!client) {
         return NextResponse.json({ error: "Client not found in this organization" }, { status: 404 });
      }
    }

    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    let subtotal = 0;
    let taxTotal = 0;

    const parsedLineItems = lineItems.map((item: { description: string; quantity: number; unitPrice: number; gstRate?: number }) => {
      const itemTotal = item.quantity * item.unitPrice;
      const taxAmount = itemTotal * ((item.gstRate || 0) / 100);
      subtotal += itemTotal;
      taxTotal += taxAmount;
      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate,
        amount: itemTotal,
        total: itemTotal + taxAmount,
      };
    });

    const total = subtotal + taxTotal;

    // Get an admin user for the relation requirement in this schema
    const admin = await prisma.user.findFirst({
      where: { organizationId, role: "admin" }
    });

    if (!admin) {
        return NextResponse.json({ error: "Organization has no active admin user" }, { status: 500 });
    }

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        status: "draft",
        dueDate: new Date(dueDate),
        subtotal,
        taxTotal,
        total,
        notes,
        isInterState: isInterState || false,
        organizationId,
        clientId,
        userId: admin.id, // Needed because schema requires userId
        lineItems: { create: parsedLineItems },
      },
    });

    // Dispatch webhook for external systems
    await fireWebhook(organizationId, "invoice.created", invoice);

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    log.error("V1 Invoice Create Error", { module: "invoices", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 });
  }
}
