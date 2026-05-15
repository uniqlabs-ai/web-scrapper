import { jsPDF } from "jspdf";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

interface InvoicePDFData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  clientName?: string;
  clientEmail?: string;
  clientCompany?: string;
  clientAddress?: string;
  clientGstNumber?: string;
  companyName?: string;
  companyAddress?: string;
  companyGstNumber?: string;
  lineItems: LineItem[];
  subtotal: number;
  taxTotal: number;
  total: number;
  isInterState: boolean;
  currency: string;
  notes?: string;
  paymentUpiId?: string;
}

function formatCurrency(amount: number, currency: string = "INR"): string {
  if (currency === "INR") return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function generateInvoicePDF(data: InvoicePDFData): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = 210;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Header
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("INVOICE", margin, y);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(data.invoiceNumber, pageWidth - margin, y, { align: "right" });
  y += 12;

  // Status badge
  const statusColors: Record<string, [number, number, number]> = {
    draft: [100, 100, 100],
    sent: [59, 130, 246],
    paid: [34, 197, 94],
    overdue: [239, 68, 68],
  };
  const statusColor = statusColors[data.status] || [100, 100, 100];
  doc.setTextColor(...statusColor);
  doc.setFont("helvetica", "bold");
  doc.text(data.status.toUpperCase(), pageWidth - margin, y, { align: "right" });
  doc.setTextColor(0);
  y += 4;

  // Company info (from)
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("FROM", margin, y);
  y += 5;
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.text(data.companyName || "Your Company", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (data.companyAddress) {
    const lines = doc.splitTextToSize(data.companyAddress, contentWidth / 2);
    doc.text(lines, margin, y);
    y += lines.length * 4;
  }
  if (data.companyGstNumber) {
    doc.text(`GSTIN: ${data.companyGstNumber}`, margin, y);
    y += 4;
  }

  // Client info (bill to) — right aligned on same y
  const billToStartY = y - 20;
  const rightX = pageWidth / 2 + 10;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("BILL TO", rightX, billToStartY);
  let rightY = billToStartY + 5;
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.text(data.clientName || "Client", rightX, rightY);
  rightY += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (data.clientCompany) {
    doc.text(data.clientCompany, rightX, rightY);
    rightY += 4;
  }
  if (data.clientEmail) {
    doc.text(data.clientEmail, rightX, rightY);
    rightY += 4;
  }
  if (data.clientAddress) {
    const lines = doc.splitTextToSize(data.clientAddress, contentWidth / 2 - 10);
    doc.text(lines, rightX, rightY);
    rightY += lines.length * 4;
  }
  if (data.clientGstNumber) {
    doc.text(`GSTIN: ${data.clientGstNumber}`, rightX, rightY);
    rightY += 4;
  }

  y = Math.max(y, rightY) + 5;

  // Dates
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Issue Date: ${formatDate(data.issueDate)}`, margin, y);
  doc.text(`Due Date: ${formatDate(data.dueDate)}`, rightX, y);
  y += 10;

  // Line items table
  doc.setDrawColor(220);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Table header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("DESCRIPTION", margin, y);
  doc.text("QTY", margin + 80, y, { align: "right" });
  doc.text("RATE", margin + 105, y, { align: "right" });
  doc.text("GST %", margin + 125, y, { align: "right" });
  doc.text("AMOUNT", pageWidth - margin, y, { align: "right" });
  y += 3;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // Table rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40);

  for (const item of data.lineItems) {
    const descLines = doc.splitTextToSize(item.description, 70);
    doc.text(descLines, margin, y);
    doc.text(String(Number(item.quantity)), margin + 80, y, { align: "right" });
    doc.text(formatCurrency(Number(item.unitPrice), data.currency), margin + 105, y, {
      align: "right",
    });
    doc.text(`${Number(item.gstRate)}%`, margin + 125, y, { align: "right" });
    doc.text(formatCurrency(Number(item.total), data.currency), pageWidth - margin, y, {
      align: "right",
    });

    y += Math.max(descLines.length * 4, 5) + 3;

    if (y > 260) {
      doc.addPage();
      y = margin;
    }
  }

  // Totals section
  y += 3;
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  const totalsX = margin + 100;
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text("Subtotal", totalsX, y);
  doc.text(formatCurrency(data.subtotal, data.currency), pageWidth - margin, y, {
    align: "right",
  });
  y += 6;

  if (data.isInterState) {
    doc.text("IGST", totalsX, y);
    doc.text(formatCurrency(data.taxTotal, data.currency), pageWidth - margin, y, {
      align: "right",
    });
  } else {
    const halfTax = data.taxTotal / 2;
    doc.text("CGST", totalsX, y);
    doc.text(formatCurrency(halfTax, data.currency), pageWidth - margin, y, { align: "right" });
    y += 6;
    doc.text("SGST", totalsX, y);
    doc.text(formatCurrency(halfTax, data.currency), pageWidth - margin, y, { align: "right" });
  }
  y += 8;

  // Total
  doc.setDrawColor(40);
  doc.line(totalsX, y - 2, pageWidth - margin, y - 2);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("TOTAL", totalsX, y + 4);
  doc.text(formatCurrency(data.total, data.currency), pageWidth - margin, y + 4, {
    align: "right",
  });

  // Notes
  if (data.notes) {
    y += 20;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100);
    doc.text("NOTES", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);
    const noteLines = doc.splitTextToSize(data.notes, contentWidth);
    doc.text(noteLines, margin, y);
  }

  // Payment Link
  if (data.paymentUpiId && data.status !== "paid") {
    y += (data.notes ? 10 : 20);
    const company = encodeURIComponent(data.companyName || "Company");
    const inv = encodeURIComponent(data.invoiceNumber);
    const upiLink = `upi://pay?pa=${data.paymentUpiId}&pn=${company}&am=${data.total}&tr=${inv}&cu=INR`;
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(59, 130, 246); // blue
    doc.text("Pay Instantly via UPI", totalsX, y);
    doc.textWithLink("Click here to pay", totalsX, y + 5, { url: upiLink });
    doc.setTextColor(0);
  }

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text("Generated by Finance — Founder OS", pageWidth / 2, 285, { align: "center" });

  return Buffer.from(doc.output("arraybuffer"));
}
