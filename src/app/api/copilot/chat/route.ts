import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantError } from "@/lib/tenant";
import { parseIntentWithAI, formatWithAI, isGeminiConfigured } from "@/lib/ai-provider";
import { log, toLogError } from "@/lib/logger";
import { CopilotChatSchema } from "@/lib/schemas";

/**
 * POST /api/copilot/chat
 *
 * In-app copilot chat endpoint. Uses Gemini AI for intent detection when
 * configured, falls back to keyword matching otherwise. Routes all queries
 * through the unified /api/v1/copilot/query endpoint.
 */

// ── Keyword fallback (used when Gemini is not configured) ──────────

const QUERY_ROUTES: Record<string, { query: string; params?: Record<string, unknown> }> = {
  runway: { query: "getRunway" },
  burn: { query: "getRunway" },
  "how long": { query: "getRunway" },
  "cash left": { query: "getRunway" },
  invoice: { query: "getInvoices" },
  unpaid: { query: "getInvoices", params: { status: "unpaid" } },
  overdue: { query: "getInvoices", params: { status: "overdue" } },
  expense: { query: "getExpenses" },
  spend: { query: "getExpenses" },
  cost: { query: "getCostByDepartment" },
  department: { query: "getCostByDepartment" },
  revenue: { query: "getRevenueByClient" },
  client: { query: "getRevenueByClient" },
  "cash flow": { query: "getCashFlowProjection" },
  projection: { query: "getCashFlowProjection" },
  forecast: { query: "getCashFlowProjection" },
  health: { query: "getFinancialHealth" },
  score: { query: "getFinancialHealth" },
};

function detectQueriesByKeyword(message: string): { query: string; params?: Record<string, unknown> }[] {
  const lower = message.toLowerCase();
  const matched = new Map<string, { query: string; params?: Record<string, unknown> }>();

  for (const [keyword, route] of Object.entries(QUERY_ROUTES)) {
    if (lower.includes(keyword) && !matched.has(route.query)) {
      matched.set(route.query, route);
    }
  }

  if (matched.size === 0) {
    matched.set("getFinancialHealth", { query: "getFinancialHealth" });
  }

  return Array.from(matched.values());
}

// ── Response formatting (keyword fallback mode) ────────────────────

function formatResponseFallback(results: Record<string, unknown>[]): string {
  const parts: string[] = [];

  for (const result of results) {
    if (!result || !result.data) continue;
    const data = result.data as Record<string, unknown>;

    if (data.runway || data.mrr) {
      const r = data.runway as Record<string, unknown> | undefined;
      parts.push(`### 📊 Financial Overview`);
      if (r) parts.push(`- **Runway**: ${r.runwayMonths} months`);
      if (data.mrr) parts.push(`- **MRR**: ₹${Number(data.mrr).toLocaleString("en-IN")}`);
      if (data.arr) parts.push(`- **ARR**: ₹${Number(data.arr).toLocaleString("en-IN")}`);
      if (data.burnRate) {
        const br = data.burnRate as Record<string, unknown>;
        parts.push(`- **Monthly Burn**: ₹${Number(br.currentMonth).toLocaleString("en-IN")}`);
      }
    }

    if (data.invoices) {
      const invoices = data.invoices as Array<Record<string, unknown>>;
      const summary = data.summary as Record<string, unknown>;
      parts.push(`### 📋 Invoices (${summary.total})`);
      if (summary.outstanding) {
        parts.push(`- **Outstanding**: ${summary.outstanding} invoices — ₹${Number(summary.outstandingAmount).toLocaleString("en-IN")}`);
      }
      for (const inv of invoices.slice(0, 5)) {
        const client = inv.client as Record<string, unknown> | null;
        parts.push(`- ${inv.invoiceNumber}: ₹${Number(inv.total).toLocaleString("en-IN")} — ${client?.name || "No client"} (${inv.status})`);
      }
    }

    if (data.expenses) {
      const summary = data.summary as Record<string, unknown>;
      const expenses = data.expenses as Array<Record<string, unknown>>;
      parts.push(`### 💸 Expenses`);
      parts.push(`- **This month**: ₹${Number(summary.thisMonth).toLocaleString("en-IN")} across ${summary.count} entries`);
      for (const exp of expenses.slice(0, 5)) {
        parts.push(`- ${exp.description}: ₹${Number(exp.amount).toLocaleString("en-IN")}`);
      }
    }

    if (data.clients) {
      const clients = data.clients as Array<Record<string, unknown>>;
      parts.push(`### 💰 Revenue by Client`);
      for (const c of clients.slice(0, 5)) {
        parts.push(`- **${c.name}**: ₹${Number(c.total).toLocaleString("en-IN")} (Recurring: ₹${Number(c.recurring).toLocaleString("en-IN")})`);
      }
    }

    if (data.score !== undefined) {
      const health = data.health as Record<string, unknown>;
      parts.push(`### 🏥 Financial Health — ${data.status}`);
      parts.push(`- **Score**: ${data.score}/100`);
      parts.push(`- **Runway**: ${health.runway} months`);
      parts.push(`- **Profit Margin**: ${health.profitMargin}%`);
      const recs = data.recommendations as string[];
      if (recs?.length) {
        parts.push(`\n**Recommendations:**`);
        for (const r of recs) parts.push(`- ${r}`);
      }
    }

    if (data.departments) {
      const depts = data.departments as Array<Record<string, unknown>>;
      parts.push(`### 🏢 Cost by Department`);
      for (const d of depts) {
        parts.push(`- **${d.department}**: ₹${Number(d.total).toLocaleString("en-IN")} (${d.count} transactions)`);
      }
      parts.push(`- **Total**: ₹${Number(data.grandTotal).toLocaleString("en-IN")}`);
    }

    if (data.projectedRunway !== undefined && !data.score) {
      parts.push(`### 📈 Cash Flow Projection`);
      parts.push(`- **Projected Runway**: ${data.projectedRunway} months`);
    }
  }

  if (parts.length === 0) {
    return `I couldn't find specific data for that. Try asking about runway, invoices, expenses, or financial health.`;
  }

  return parts.join("\n");
}

// ── Main handler ───────────────────────────────────────────────────

async function fetchQueries(
  baseUrl: string,
  cookies: string,
  queries: { query: string; params?: Record<string, unknown> }[]
): Promise<Record<string, unknown>[]> {
  if (!queries || queries.length === 0) return [];
  return Promise.all(
    queries.map(async ({ query, params }) => {
      try {
        const res = await fetch(`${baseUrl}/api/v1/copilot/query`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: cookies },
          body: JSON.stringify({ query, params }),
        });
        return res.ok ? await res.json() : {};
      } catch {
        return {};
      }
    })
  );
}

async function fetchActions(
  baseUrl: string,
  cookies: string,
  actions: { action: string; params?: Record<string, unknown> }[]
): Promise<Record<string, unknown>[]> {
  if (!actions || actions.length === 0) return [];
  return Promise.all(
    actions.map(async ({ action, params }) => {
      try {
        const res = await fetch(`${baseUrl}/api/v1/copilot/action`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: cookies },
          body: JSON.stringify({ action, params }),
        });
        return res.ok ? await res.json() : {};
      } catch {
        return {};
      }
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    await requireTenant();
    const rawBody = await request.json();

    const parsed = CopilotChatSchema.safeParse(rawBody);

    if (!parsed.success) {

      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });

    }

    const { message } = parsed.data;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const baseUrl = request.nextUrl.origin;
    const cookies = request.headers.get("cookie") || "";

    // Try Gemini AI first, fall back to keyword detection
    let queries: { query: string; params?: Record<string, unknown> }[] = [];
    let actions: { action: string; params?: Record<string, unknown> }[] = [];
    let aiSummary: string | undefined;

    if (isGeminiConfigured()) {
      const aiIntent = await parseIntentWithAI(message);
      if (aiIntent) {
        queries = aiIntent.queries || [];
        actions = aiIntent.actions || [];
        aiSummary = aiIntent.summary;
      } else {
        queries = detectQueriesByKeyword(message);
      }
    } else {
      queries = detectQueriesByKeyword(message);
    }

    const queryResults = await fetchQueries(baseUrl, cookies, queries);
    const actionResults = await fetchActions(baseUrl, cookies, actions);
    const results = [...queryResults, ...actionResults];

    // Try AI-formatted response, fall back to template-based
    let response: string;
    if (isGeminiConfigured() && aiSummary) {
      const aiResponse = await formatWithAI(message, results, aiSummary);
      response = aiResponse || formatResponseFallback(results);
    } else {
      response = formatResponseFallback(results);
    }

    // Action Intent Detection
    let actionPayload: { type: string; label: string; url?: string; method?: string } | undefined;
    const msgLower = message.toLowerCase();
    if (msgLower.includes("email") || (msgLower.includes("remind") && msgLower.includes("overdue"))) {
      actionPayload = { type: "api_call", label: "Send Follow-up Emails", url: "/api/invoices/remind", method: "GET" };
    } else if (msgLower.includes("anomal") || msgLower.includes("scan")) {
      actionPayload = { type: "api_call", label: "Run Anomaly Scan", url: "/api/anomalies", method: "GET" };
    } else if (msgLower.includes("reconcil") || msgLower.includes("match")) {
      actionPayload = { type: "api_call", label: "Run Auto-Reconciliation", url: "/api/reconciliation/auto-match", method: "POST" };
    } else if (msgLower.includes("brief") || msgLower.includes("cfo")) {
      actionPayload = { type: "api_call", label: "Send Weekly CFO Brief", url: "/api/cfo-brief", method: "POST" };
    }

    return NextResponse.json({
      response,
      action: actionPayload,
      sources: queries.map((q) => q.query),
      aiPowered: isGeminiConfigured(),
    });
  } catch (error) {
    log.error("Copilot chat error", { module: "copilot", action: "chat", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to process query" }, { status: 500 });
  }
}
