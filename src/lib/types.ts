export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type RevenueType = "recurring" | "one-time";
export type AccountType = "bank" | "cash" | "credit";

export interface DashboardKPIs {
  monthlyRevenue: number;
  burnRate: number;
  runwayMonths: number;
  outstandingInvoices: { count: number; total: number };
  totalExpensesThisMonth: number;
  revenueGrowth: number;
}

export interface RunwayData {
  cashInBank: number;
  monthlyBurn: number;
  runwayMonths: number;
  projectedRunOutDate: string | null;
}

export interface BurnRateData {
  currentMonth: number;
  previousMonth: number;
  average3Month: number;
  trend: "increasing" | "decreasing" | "stable";
}

export interface RevenueData {
  currentMRR: number;
  currentARR: number;
  previousMRR: number;
  growth: number;
  history: { month: string; amount: number }[];
  totalMonthlyRevenue: number;
}

export interface GSTBreakdown {
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
  auth: { type: string; tokenEndpoint: string };
  copilot: {
    capabilities: string[];
    queries: { name: string; endpoint: string; description: string }[];
    actions: {
      name: string;
      endpoint: string;
      description: string;
      confirmRequired: boolean;
    }[];
  };
  webhookEvents: string[];
}
