/**
 * TDS (Tax Deducted at Source) rates and utilities
 * Based on Indian Income Tax Act — Updated for FY 2025-26 (effective 1 Apr 2025)
 * Reference: Finance Act 2025 (Union Budget 2025-26)
 */

export interface TDSSection {
  section: string;
  description: string;
  rate: number;        // percentage
  threshold: number;   // annual threshold below which TDS not applicable
  panAbsentRate: number; // rate when PAN not available (usually 20%)
}

// FY 2025-26 TDS rate table — verified against Finance Act 2025
export const TDS_SECTIONS: TDSSection[] = [
  { section: "194C", description: "Contractor payments (individuals/HUF)", rate: 1, threshold: 30000, panAbsentRate: 20 },
  { section: "194C", description: "Contractor payments (others)", rate: 2, threshold: 30000, panAbsentRate: 20 },
  { section: "194J(a)", description: "Professional fees — technical services", rate: 2, threshold: 50000, panAbsentRate: 20 },
  { section: "194J(b)", description: "Professional fees — others", rate: 10, threshold: 50000, panAbsentRate: 20 },
  { section: "194H", description: "Commission / brokerage", rate: 2, threshold: 20000, panAbsentRate: 20 },
  { section: "194I(a)", description: "Rent — machinery/equipment", rate: 2, threshold: 600000, panAbsentRate: 20 },
  { section: "194I(b)", description: "Rent — land/building", rate: 10, threshold: 600000, panAbsentRate: 20 },
  { section: "194A", description: "Interest (other than bank)", rate: 10, threshold: 10000, panAbsentRate: 20 },
  { section: "194A_BANK", description: "Interest (bank/co-op/post office)", rate: 10, threshold: 50000, panAbsentRate: 20 },
  { section: "194A_SENIOR", description: "Interest (bank — senior citizen)", rate: 10, threshold: 100000, panAbsentRate: 20 },
  { section: "194D", description: "Insurance commission", rate: 5, threshold: 20000, panAbsentRate: 20 },
  { section: "194Q", description: "Purchase of goods", rate: 0.1, threshold: 5000000, panAbsentRate: 5 },
  { section: "194R", description: "Benefits / perquisites", rate: 10, threshold: 20000, panAbsentRate: 20 },
  { section: "194S", description: "Virtual digital assets (crypto)", rate: 1, threshold: 10000, panAbsentRate: 20 },
];

export interface TDSCalculation {
  section: string;
  grossAmount: number;
  tdsRate: number;
  tdsAmount: number;
  netPayable: number;
  hasPAN: boolean;
}

export function calculateTDS(
  amount: number,
  section: string,
  hasPAN: boolean = true
): TDSCalculation {
  const sectionData = TDS_SECTIONS.find((s) => s.section === section);
  if (!sectionData) {
    return { section, grossAmount: amount, tdsRate: 0, tdsAmount: 0, netPayable: amount, hasPAN };
  }

  const rate = hasPAN ? sectionData.rate : sectionData.panAbsentRate;
  const tdsAmount = Math.round((amount * rate) / 100);
  const netPayable = amount - tdsAmount;

  return { section, grossAmount: amount, tdsRate: rate, tdsAmount, netPayable, hasPAN };
}

export function getSectionForExpenseType(type: string): string | null {
  const mapping: Record<string, string> = {
    "Professional Services": "194J(b)",
    "Legal": "194J(b)",
    "Consulting": "194J(b)",
    "Rent": "194I(b)",
    "Office Rent": "194I(b)",
    "Infrastructure Rent": "194I(a)",
    "Commission": "194H",
    "Contractor": "194C",
    "Interest": "194A",
    "Technical Services": "194J(a)",
    "Software Development": "194J(a)",
  };
  return mapping[type] || null;
}

export const TDS_QUARTERS = [
  { quarter: "Q1", months: "Apr-Jun", dueDate: "Jul 31" },
  { quarter: "Q2", months: "Jul-Sep", dueDate: "Oct 31" },
  { quarter: "Q3", months: "Oct-Dec", dueDate: "Jan 31" },
  { quarter: "Q4", months: "Jan-Mar", dueDate: "May 31" },
];

export function getCurrentQuarter(): { quarter: string; startMonth: number; endMonth: number } {
  const month = new Date().getMonth(); // 0-indexed
  if (month >= 3 && month <= 5) return { quarter: "Q1", startMonth: 3, endMonth: 5 };
  if (month >= 6 && month <= 8) return { quarter: "Q2", startMonth: 6, endMonth: 8 };
  if (month >= 9 && month <= 11) return { quarter: "Q3", startMonth: 9, endMonth: 11 };
  return { quarter: "Q4", startMonth: 0, endMonth: 2 };
}
