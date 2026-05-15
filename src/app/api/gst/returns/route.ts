import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

const GstReturnsQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM").optional(),
  type: z.enum(["gstr1", "gstr3b"]).default("gstr3b"),
});

/**
 * GET /api/gst/returns — Generate GSTR-1 (sales) and GSTR-3B (summary) data
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);

    const parsed = GstReturnsQuerySchema.safeParse({
      month: searchParams.get("month") || undefined,
      type: searchParams.get("type") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const { month, type } = parsed.data;

    const now = new Date();
    const targetMonth = month
      ? new Date(`${month}-01`)
      : new Date(now.getFullYear(), now.getMonth() - 1, 1); // Previous month default

    const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);

    if (type === "gstr1") {
      // GSTR-1: Sales register with invoice-level detail
      const invoices = await prisma.invoice.findMany({
      take: 10000,
        where: {
          userId,
          organizationId,
          issueDate: { gte: targetMonth, lte: monthEnd },
          status: { not: "draft" },
        },
        include: {
          client: { select: { name: true, gstNumber: true, company: true } },
          lineItems: true,
        },
        orderBy: { issueDate: "asc" },
      });

      // Categorize: B2B (with GSTIN), B2C (without)
      const b2b = invoices.filter((inv) => inv.client?.gstNumber);
      const b2c = invoices.filter((inv) => !inv.client?.gstNumber);

      const b2bEntries = b2b.map((inv) => {
        const taxableValue = Number(inv.subtotal);
        let totalCGST = 0, totalSGST = 0, totalIGST = 0;
        for (const item of inv.lineItems) {
          totalCGST += Number(item.cgst);
          totalSGST += Number(item.sgst);
          totalIGST += Number(item.igst);
        }
        return {
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.issueDate.toISOString().slice(0, 10),
          customerName: inv.client?.name || "",
          customerGSTIN: inv.client?.gstNumber || "",
          placeOfSupply: inv.placeOfSupply || "29-Karnataka",
          isInterState: inv.isInterState,
          taxableValue,
          cgst: totalCGST,
          sgst: totalSGST,
          igst: totalIGST,
          totalTax: totalCGST + totalSGST + totalIGST,
          invoiceValue: Number(inv.total),
        };
      });

      const b2cTotal = b2c.reduce((acc, inv) => {
        let cgst = 0, sgst = 0, igst = 0;
        for (const item of inv.lineItems) {
          cgst += Number(item.cgst);
          sgst += Number(item.sgst);
          igst += Number(item.igst);
        }
        return {
          taxableValue: acc.taxableValue + Number(inv.subtotal),
          cgst: acc.cgst + cgst,
          sgst: acc.sgst + sgst,
          igst: acc.igst + igst,
          count: acc.count + 1,
        };
      }, { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, count: 0 });

      return NextResponse.json({
        type: "gstr1",
        period: targetMonth.toISOString().slice(0, 7),
        filingDue: `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 2).padStart(2, "0")}-11`,
        b2b: {
          count: b2bEntries.length,
          entries: b2bEntries,
          totalTaxable: b2bEntries.reduce((s, e) => s + e.taxableValue, 0),
          totalTax: b2bEntries.reduce((s, e) => s + e.totalTax, 0),
        },
        b2c: {
          count: b2cTotal.count,
          totalTaxable: b2cTotal.taxableValue,
          cgst: b2cTotal.cgst,
          sgst: b2cTotal.sgst,
          igst: b2cTotal.igst,
        },
        totalInvoices: invoices.length,
      });
    } else {
      // GSTR-3B: Monthly summary return
      const [invoices, expenses] = await Promise.all([
        prisma.invoice.findMany({
      take: 10000,
          where: {
            userId,
            organizationId,
            issueDate: { gte: targetMonth, lte: monthEnd },
            status: { not: "draft" },
          },
          include: { lineItems: true },
        }),
        prisma.expense.findMany({
      take: 10000,
          where: { userId, organizationId, date: { gte: targetMonth, lte: monthEnd } },
        }),
      ]);

      // Output tax (on sales)
      let outCGST = 0, outSGST = 0, outIGST = 0, totalTaxableSupply = 0;
      for (const inv of invoices) {
        totalTaxableSupply += Number(inv.subtotal);
        for (const item of inv.lineItems) {
          outCGST += Number(item.cgst);
          outSGST += Number(item.sgst);
          outIGST += Number(item.igst);
        }
      }

      // Input tax credit (estimated 18% on expenses with receipts)
      const expensesWithReceipts = expenses.filter((e) => e.receipt);
      const totalExpenseAmount = expensesWithReceipts.reduce((s, e) => s + Number(e.amount), 0);
      const itcCGST = Math.round(totalExpenseAmount * 0.09 * 100) / 100;
      const itcSGST = Math.round(totalExpenseAmount * 0.09 * 100) / 100;

      const netCGST = Math.max(0, outCGST - itcCGST);
      const netSGST = Math.max(0, outSGST - itcSGST);
      const netIGST = outIGST; // IGST typically doesn't have ITC offset in simplified model

      return NextResponse.json({
        type: "gstr3b",
        period: targetMonth.toISOString().slice(0, 7),
        filingDue: `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 2).padStart(2, "0")}-20`,
        outwardSupplies: {
          taxableValue: totalTaxableSupply,
          cgst: Math.round(outCGST * 100) / 100,
          sgst: Math.round(outSGST * 100) / 100,
          igst: Math.round(outIGST * 100) / 100,
          totalTax: Math.round((outCGST + outSGST + outIGST) * 100) / 100,
          invoiceCount: invoices.length,
        },
        inputTaxCredit: {
          cgst: itcCGST,
          sgst: itcSGST,
          igst: 0,
          totalITC: Math.round((itcCGST + itcSGST) * 100) / 100,
          expenseCount: expensesWithReceipts.length,
        },
        netTaxPayable: {
          cgst: Math.round(netCGST * 100) / 100,
          sgst: Math.round(netSGST * 100) / 100,
          igst: Math.round(netIGST * 100) / 100,
          total: Math.round((netCGST + netSGST + netIGST) * 100) / 100,
        },
      });
    }
  } catch (error) {
    log.error("GST returns error", { module: "gst", action: "returns", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to generate GST return data" }, { status: 500 });
  }
}
