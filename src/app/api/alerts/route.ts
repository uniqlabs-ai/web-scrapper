import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { detectAnomalies } from "@/lib/anomalies";
import { log, toLogError } from "@/lib/logger";

interface Alert {
  id: string;
  type: "danger" | "warning" | "info";
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

// GET: Generate smart alerts for the dashboard
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const now = new Date();
    const alerts: Alert[] = [];

    // 1. LOW CASH WARNING
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    // Get actual cash from BankAccount (not the stale org field)
    const bankAccounts = await prisma.bankAccount.findMany({
      take: 50,
      where: { userId, isActive: true },
    });
    const cashInBank = bankAccounts.reduce((sum, a) => sum + Number(a.currentBalance), 0);

    {
      // Calculate monthly burn
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentExpenses = await prisma.expense.aggregate({
        where: { userId, date: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      });
      const monthlyBurn = Number(recentExpenses._sum.amount || 0);
      const runwayMonths = monthlyBurn > 0 ? cashInBank / monthlyBurn : Infinity;

      if (runwayMonths < 3 && monthlyBurn > 0) {
        alerts.push({
          id: "low-cash",
          type: "danger",
          title: "Low Cash Runway",
          message: `Only ${runwayMonths.toFixed(1)} months of runway remaining at current burn rate (₹${monthlyBurn.toLocaleString("en-IN")}/mo)`,
          action: "View Forecast",
          actionUrl: "/forecast",
        });
      } else if (runwayMonths < 6 && monthlyBurn > 0) {
        alerts.push({
          id: "cash-warning",
          type: "warning",
          title: "Cash Runway Warning",
          message: `${runwayMonths.toFixed(1)} months runway. Consider reviewing expenses or accelerating revenue.`,
          action: "View Expenses",
          actionUrl: "/expenses",
        });
      }
    }

    // 2. OVERDUE INVOICES
    const overdueInvoices = await prisma.invoice.findMany({
      take: 50,
      where: {
        userId,
        status: { in: ["sent", "overdue"] },
        dueDate: { lt: now },
      },
    });

    if (overdueInvoices.length > 0) {
      const totalOverdue = overdueInvoices.reduce(
        (sum, inv) => sum + Number(inv.total),
        0
      );
      const maxDaysPast = Math.max(
        ...overdueInvoices.map((inv) =>
          Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        )
      );

      alerts.push({
        id: "overdue-invoices",
        type: maxDaysPast > 30 ? "danger" : "warning",
        title: `${overdueInvoices.length} Overdue Invoice${overdueInvoices.length > 1 ? "s" : ""}`,
        message: `₹${totalOverdue.toLocaleString("en-IN")} outstanding. Oldest is ${maxDaysPast} days past due.`,
        action: "Send Reminders",
        actionUrl: "/invoices",
      });
    }

    // 3. UPCOMING COMPLIANCE DEADLINES
    const upcomingDeadlines: { date: Date; name: string }[] = [];
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // GST filing deadlines
    const gstDeadline = new Date(currentYear, now.getMonth(), 20);
    if (gstDeadline > now && gstDeadline.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
      upcomingDeadlines.push({ date: gstDeadline, name: "GSTR-3B Filing" });
    }

    // TDS return deadline
    if ([7, 10, 1, 4].includes(currentMonth)) {
      const tdsDeadline = new Date(currentYear, now.getMonth(), currentMonth === 4 ? 30 : 31);
      if (tdsDeadline > now && tdsDeadline.getTime() - now.getTime() < 15 * 24 * 60 * 60 * 1000) {
        upcomingDeadlines.push({ date: tdsDeadline, name: "Quarterly TDS Return (24Q/26Q)" });
      }
    }

    // Advance tax deadlines
    const advTaxDates = [
      { month: 6, day: 15, name: "Advance Tax - Q1" },
      { month: 9, day: 15, name: "Advance Tax - Q2" },
      { month: 12, day: 15, name: "Advance Tax - Q3" },
      { month: 3, day: 15, name: "Advance Tax - Q4" },
    ];
    for (const atd of advTaxDates) {
      const deadline = new Date(currentYear, atd.month - 1, atd.day);
      if (deadline > now && deadline.getTime() - now.getTime() < 15 * 24 * 60 * 60 * 1000) {
        upcomingDeadlines.push({ date: deadline, name: atd.name });
      }
    }

    if (upcomingDeadlines.length > 0) {
      const nearest = upcomingDeadlines.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      const daysUntil = Math.ceil((nearest.date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      alerts.push({
        id: "compliance-deadline",
        type: daysUntil <= 3 ? "danger" : "warning",
        title: `${nearest.name} Due`,
        message: `Due in ${daysUntil} day${daysUntil > 1 ? "s" : ""} (${nearest.date.toLocaleDateString("en-IN")})${upcomingDeadlines.length > 1 ? ` · +${upcomingDeadlines.length - 1} more deadlines` : ""}`,
        action: "View Calendar",
        actionUrl: "/compliance",
      });
    }

    // 4. UNRECONCILED TRANSACTIONS
    const unreconciledCount = await prisma.bankTransaction.count({
      where: { userId, isReconciled: false },
    });

    if (unreconciledCount > 10) {
      alerts.push({
        id: "unreconciled",
        type: "info",
        title: `${unreconciledCount} Unreconciled Transactions`,
        message: "Bank transactions need to be matched to expenses/invoices.",
        action: "Auto-Reconcile",
        actionUrl: "/reconciliation",
      });
    }

    // 5. RECURRING EXPENSES DUE
    const dueSoon = await prisma.recurringExpense.count({
      where: {
        userId,
        isActive: true,
        nextDueDate: { lte: now },
      },
    });

    if (dueSoon > 0) {
      alerts.push({
        id: "recurring-due",
        type: "info",
        title: `${dueSoon} Recurring Expenses Due`,
        message: "These recurring expenses need to be processed.",
        action: "Process Now",
        actionUrl: "/recurring",
      });
    }

    // 6. BUDGET OVERRUNS
    const userOrg = user?.organizationId;
    const budgets = userOrg ? await prisma.budgetThreshold.findMany({
      take: 50,
      where: { organizationId: userOrg },
    }) : [];

    if (budgets.length > 0) {
      const firstDayOfMonth = new Date(currentYear, now.getMonth(), 1);
      for (const budget of budgets) {
        const spent = await prisma.expense.aggregate({
          where: {
            userId,
            category: { name: budget.category },
            date: { gte: firstDayOfMonth },
          },
          _sum: { amount: true },
        });
        const spentAmount = Number(spent._sum?.amount || 0);
        const limit = Number(budget.monthlyLimit);
        if (spentAmount > limit) {
          alerts.push({
            id: `budget-${budget.category}`,
            type: "warning",
            title: `Budget Exceeded: ${budget.category}`,
            message: `Spent ₹${spentAmount.toLocaleString("en-IN")} of ₹${limit.toLocaleString("en-IN")} budget (${Math.round((spentAmount / limit) * 100)}%)`,
            action: "View Budgets",
            actionUrl: "/budgets",
          });
        }
      }
    }

    // 7. AI AUDITOR ANOMALIES
    const aiAlerts = await detectAnomalies(userId);
    alerts.push(...aiAlerts);

    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error) {
    log.error("Smart alerts error", { module: "alerts", action: "handler", error: toLogError(error) });
    return NextResponse.json({ alerts: [], count: 0 });
  }
}
