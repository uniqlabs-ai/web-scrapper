import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { getCurrentQuarter, TDS_QUARTERS } from "@/lib/tds";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/compliance/calendar — Upcoming deadlines and obligations
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // Generate upcoming deadlines
    const deadlines: Array<{
      date: string;
      type: string;
      title: string;
      description: string;
      status: "upcoming" | "due_today" | "overdue" | "completed";
      priority: "high" | "medium" | "low";
    }> = [];

    // GST deadlines: GSTR-3B due on 20th, GSTR-1 due on 11th
    for (let i = -1; i <= 3; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const _monthLabel = m.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
      const prevMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1);
      const prevLabel = prevMonth.toLocaleDateString("en-IN", { month: "short", year: "numeric" });

      // GSTR-1 due on 11th
      const gstr1Due = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-11`;
      deadlines.push({
        date: gstr1Due,
        type: "GST",
        title: `GSTR-1 — ${prevLabel}`,
        description: "Sales return for registered buyers",
        status: gstr1Due < today ? "overdue" : gstr1Due === today ? "due_today" : "upcoming",
        priority: gstr1Due < today ? "high" : "medium",
      });

      // GSTR-3B due on 20th
      const gstr3bDue = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-20`;
      deadlines.push({
        date: gstr3bDue,
        type: "GST",
        title: `GSTR-3B — ${prevLabel}`,
        description: "Monthly summary return with tax payment",
        status: gstr3bDue < today ? "overdue" : gstr3bDue === today ? "due_today" : "upcoming",
        priority: gstr3bDue < today ? "high" : "medium",
      });
    }

    // TDS quarterly return deadlines
    const _currentQ = getCurrentQuarter();
    for (const q of TDS_QUARTERS) {
      const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const qDates: Record<string, string> = {
        Q1: `${fy}-07-31`,
        Q2: `${fy}-10-31`,
        Q3: `${fy + 1}-01-31`,
        Q4: `${fy + 1}-05-31`,
      };
      const dueDate = qDates[q.quarter];
      deadlines.push({
        date: dueDate,
        type: "TDS",
        title: `TDS Return — ${q.quarter} (${q.months})`,
        description: `Form 26Q/24Q filing for ${q.months}`,
        status: dueDate < today ? "overdue" : dueDate === today ? "due_today" : "upcoming",
        priority: dueDate < today ? "high" : "low",
      });
    }

    // TDS monthly deposit deadlines (7th of following month; March exception: 30th April)
    for (let i = -1; i <= 3; i++) {
      const deductionMonth = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const deductionLabel = deductionMonth.toLocaleDateString("en-IN", { month: "short", year: "numeric" });

      // March TDS has special deadline of 30th April; all others are 7th of next month
      const isMarch = deductionMonth.getMonth() === 2; // 0-indexed: March = 2
      const depositMonth = new Date(deductionMonth.getFullYear(), deductionMonth.getMonth() + 1, 1);
      const depositDay = isMarch ? 30 : 7;
      const depositDate = `${depositMonth.getFullYear()}-${String(depositMonth.getMonth() + 1).padStart(2, "0")}-${String(depositDay).padStart(2, "0")}`;

      deadlines.push({
        date: depositDate,
        type: "TDS",
        title: `TDS Deposit — ${deductionLabel}`,
        description: isMarch
          ? "TDS deducted in March — deposit by 30th April"
          : `TDS challan payment for deductions in ${deductionLabel}`,
        status: depositDate < today ? "overdue" : depositDate === today ? "due_today" : "upcoming",
        priority: depositDate < today ? "high" : "medium",
      });
    }

    // Advance Tax deadlines (15th of Jun, Sep, Dec, Mar)
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const advTaxDates = [
      { date: `${fyStart}-06-15`, label: "Advance Tax — June (15%)" },
      { date: `${fyStart}-09-15`, label: "Advance Tax — September (45%)" },
      { date: `${fyStart}-12-15`, label: "Advance Tax — December (75%)" },
      { date: `${fyStart + 1}-03-15`, label: "Advance Tax — March (100%)" },
    ];
    for (const at of advTaxDates) {
      deadlines.push({
        date: at.date,
        type: "Income Tax",
        title: at.label,
        description: "Installment of advance income tax",
        status: at.date < today ? "overdue" : at.date === today ? "due_today" : "upcoming",
        priority: "medium",
      });
    }

    // Invoice due dates (next 30 days)
    const thirtyDaysLater = new Date(now.getTime() + 30 * 86400000);
    const dueInvoices = await prisma.invoice.findMany({
      take: 10000,
      where: {
        userId,
        status: { in: ["sent", "overdue", "partial"] },
        dueDate: { lte: thirtyDaysLater },
      },
      include: { client: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    });

    for (const inv of dueInvoices) {
      const dueDate = inv.dueDate.toISOString().slice(0, 10);
      deadlines.push({
        date: dueDate,
        type: "Receivable",
        title: `${inv.invoiceNumber} — ${inv.client?.name || "Client"}`,
        description: `₹${Number(inv.total).toLocaleString("en-IN")} due`,
        status: dueDate < today ? "overdue" : dueDate === today ? "due_today" : "upcoming",
        priority: dueDate < today ? "high" : "low",
      });
    }

    // Sort by date
    deadlines.sort((a, b) => a.date.localeCompare(b.date));

    // Summary
    const overdue = deadlines.filter((d) => d.status === "overdue").length;
    const dueToday = deadlines.filter((d) => d.status === "due_today").length;
    const upcoming = deadlines.filter((d) => d.status === "upcoming").length;

    return NextResponse.json({
      deadlines,
      summary: { overdue, dueToday, upcoming, total: deadlines.length },
    });
  } catch (error) {
    log.error("Compliance calendar error", { module: "compliance", action: "calendar", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load calendar" }, { status: 500 });
  }
}
