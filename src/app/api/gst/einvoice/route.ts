import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const EinvoiceQuerySchema = z.object({
  invoiceId: z.string().min(1, "invoiceId is required"),
});

/**
 * GET /api/gst/einvoice — Generate e-invoicing JSON for IRP portal
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const parsed = EinvoiceQuerySchema.safeParse({ invoiceId: searchParams.get("invoiceId") });
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { invoiceId } = parsed.data;

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, userId, organizationId },
      include: { client: true, lineItems: true },
    });

    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    const org = await prisma.organization.findFirst({
      where: { id: organizationId },
    });

    // E-invoice JSON as per Indian GST e-invoicing schema (simplified)
    const eInvoice = {
      Version: "1.1",
      TranDtls: {
        TaxSch: "GST",
        SupTyp: invoice.isInterState ? "INTER" : "INTRA",
        RegRev: "N",
        IgstOnIntra: "N",
      },
      DocDtls: {
        Typ: "INV",
        No: invoice.invoiceNumber,
        Dt: invoice.issueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }),
      },
      SellerDtls: {
        Gstin: org?.gstNumber || "UNREGISTERED",
        LglNm: org?.name || "Seller",
        Addr1: org?.address || "",
        Loc: "Bangalore",
        Pin: 560001,
        Stcd: "29",
      },
      BuyerDtls: {
        Gstin: invoice.client?.gstNumber || "URP",
        LglNm: invoice.client?.name || "Buyer",
        Pos: "29",
        Addr1: invoice.client?.address || "",
        Loc: "India",
        Pin: 560001,
        Stcd: "29",
      },
      ItemList: invoice.lineItems.map((item, i) => ({
        SlNo: String(i + 1),
        PrdDesc: item.description,
        IsServc: "Y",
        HsnCd: "998311",
        Qty: Number(item.quantity),
        Unit: "NOS",
        UnitPrice: Number(item.unitPrice),
        TotAmt: Number(item.amount),
        AssAmt: Number(item.amount),
        GstRt: 18,
        CgstAmt: Number(item.cgst),
        SgstAmt: Number(item.sgst),
        IgstAmt: Number(item.igst),
        TotItemVal: Number(item.amount) + Number(item.cgst) + Number(item.sgst) + Number(item.igst),
      })),
      ValDtls: {
        AssVal: Number(invoice.subtotal),
        CgstVal: invoice.lineItems.reduce((s, i) => s + Number(i.cgst), 0),
        SgstVal: invoice.lineItems.reduce((s, i) => s + Number(i.sgst), 0),
        IgstVal: invoice.lineItems.reduce((s, i) => s + Number(i.igst), 0),
        TotInvVal: Number(invoice.total),
      },
    };

    return NextResponse.json({
      eInvoice,
      invoiceNumber: invoice.invoiceNumber,
      note: "This JSON can be uploaded to the GST IRP portal (einvoice1.gst.gov.in) for IRN generation",
    });
  } catch (error) {
    log.error("E-invoicing error", { module: "gst", action: "einvoice", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
