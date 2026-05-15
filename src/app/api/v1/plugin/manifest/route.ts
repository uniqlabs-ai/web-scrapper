import { NextResponse } from "next/server";
import { log, toLogError } from "@/lib/logger";

export async function GET() {
  try {
    const manifest = {
      id: "finance",
      name: "Finance",
      description: "Accounting, invoicing, expense tracking, runway projections, and GST compliance for startups",
      icon: "💰",
      url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3008",
      auth: {
        type: "shared-session",
        tokenEndpoint: "/api/v1/auth/founder-os-token",
      },
      copilot: {
        queryEndpoint: "/api/v1/copilot/query",
        capabilities: [
          "Track invoices, expenses, and revenue",
          "Calculate runway and burn rate",
          "Generate GST-compliant invoices",
          "Generate financial reports (P&L, cash flow)",
        ],
        queries: [
          { name: "getRunway", description: "Get runway in months, burn rate, MRR/ARR" },
          { name: "getExpenses", description: "List recent expenses, filterable by category and date range" },
          { name: "getInvoices", description: "List invoices, filterable by status (unpaid, sent, overdue)" },
          { name: "getCashFlowProjection", description: "Project cash flow for N months" },
          { name: "getCostByDepartment", description: "Breakdown of expenses by department" },
          { name: "getFinancialHealth", description: "Overall financial health score and recommendations" },
          { name: "getRevenueByClient", description: "Revenue breakdown by client" },
        ],
        actions: [
          { name: "createInvoice", description: "Create a new GST-compliant invoice", confirmRequired: true },
          { name: "logExpense", description: "Log an expense", confirmRequired: false },
        ],
      },
      webhookEvents: ["invoice.created", "invoice.paid", "expense.logged", "runway.warning"],
    };

    return NextResponse.json(manifest);
  } catch (error) {
    log.error("[Plugin Manifest] Error", { module: "plugin", action: "manifest", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to serve plugin manifest" }, { status: 500 });
  }
}
