/**
 * AI Provider — Multi-model abstraction for Finance Copilot
 *
 * Uses Google Gemini for natural language understanding.
 * Falls back to keyword detection when GEMINI_API_KEY is not set.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { log, toLogError } from "@/lib/logger";

const SYSTEM_PROMPT = `You are a finance copilot for a startup. You have access to the following data queries:

QUERIES (use these exact names):
- getRunway — runway months, burn rate, MRR/ARR
- getExpenses — expense list, filterable by category/date
- getInvoices — invoice list, filterable by status (unpaid/overdue/sent/paid)
- getCashFlowProjection — cash flow projection for N months
- getCostByDepartment — expense breakdown by department
- getFinancialHealth — overall health score and recommendations
- getRevenueByClient — revenue breakdown by client

ACTIONS (use these exact names to mutate data):
- logExpense — params: description, amount, date
- createInvoice — params: clientId (or null), dueDate, lineItems
- recordRevenue — params: amount, type, source, clientId (or null)

Given a user message, respond with a JSON object:
{
  "queries": [{ "query": "<query_name>", "params": { ... } }],
  "actions": [{ "action": "<action_name>", "params": { ... } }],
  "summary": "<brief natural language intro to preface the data>"
}

Rules:
- Pick the most relevant 1-3 queries/actions for the user's question
- Use params to filter or construct the resource
- If the user asks something you can't answer with these, use getFinancialHealth as default
- Always respond with valid JSON only, no markdown or explanation`;

let geminiModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null = null;

function getModel() {
  if (geminiModel) return geminiModel;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  return geminiModel;
}

export interface CopilotIntent {
  queries?: { query: string; params?: Record<string, unknown> }[];
  actions?: { action: string; params?: Record<string, unknown> }[];
  summary: string;
}

/**
 * Use Gemini to understand user intent and extract structured queries.
 * Returns null if Gemini is unavailable (caller should fall back to keywords).
 */
export async function parseIntentWithAI(message: string): Promise<CopilotIntent | null> {
  const model = getModel();
  if (!model) return null;

  try {
    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: message },
    ]);

    const text = result.response.text().trim();
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as CopilotIntent;

    if (!parsed.queries && !parsed.actions) return null;
    return parsed;
  } catch (error) {
    log.warn("Gemini parse failed, falling back to keywords", { module: "ai-provider", action: "parseIntent", error: toLogError(error) });
    return null;
  }
}

/**
 * Use Gemini to format raw data into a natural language response.
 * Returns null if Gemini is unavailable.
 */
export async function formatWithAI(
  userMessage: string,
  rawData: Record<string, unknown>[],
  summary: string
): Promise<string | null> {
  const model = getModel();
  if (!model) return null;

  try {
    const result = await model.generateContent([
      {
        text: `You are a finance copilot. The user asked: "${userMessage}"
Here is the raw data from our financial system:
${JSON.stringify(rawData, null, 2)}

Format this into a helpful, concise markdown response. Use:
- Headers (###) to organize sections
- Emoji icons for visual clarity
- Currency in ₹ with Indian formatting
- Bold for key numbers
- Keep it under 500 words
- Start with: ${summary}`,
      },
    ]);

    return result.response.text().trim();
  } catch (error) {
    log.warn("Gemini format failed", { module: "ai-provider", action: "formatResponse", error: toLogError(error) });
    return null;
  }
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
