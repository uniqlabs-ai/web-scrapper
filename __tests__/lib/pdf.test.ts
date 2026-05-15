import { describe, it, expect } from 'vitest';
import { generateInvoicePDF } from '@/lib/pdf';

function baseData() {
  return {
    invoiceNumber: 'INV-001',
    issueDate: '2025-04-01',
    dueDate: '2025-05-01',
    status: 'sent',
    clientName: 'Acme Corp',
    clientEmail: 'billing@acme.com',
    clientCompany: 'Acme Inc',
    clientAddress: 'Bangalore, India',
    clientGstNumber: '29AABCU1234F1Z5',
    companyName: 'MyStartup',
    companyAddress: 'HSR Layout, Bangalore',
    companyGstNumber: '29XXXXX1234X1Z5',
    lineItems: [
      { description: 'Consulting Services', quantity: 10, unitPrice: 10000, amount: 100000, gstRate: 18, cgst: 9000, sgst: 9000, igst: 0, total: 118000 },
    ],
    subtotal: 100000,
    taxTotal: 18000,
    total: 118000,
    isInterState: false,
    currency: 'INR',
    notes: 'Payment due within 30 days',
  };
}

describe('generateInvoicePDF', () => {
  it('generates a valid PDF buffer for intra-state invoice', () => {
    const buffer = generateInvoicePDF(baseData());
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    // PDF header
    expect(buffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('generates PDF for inter-state invoice (IGST)', () => {
    const data = { ...baseData(), isInterState: true };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('generates PDF with USD currency', () => {
    const data = { ...baseData(), currency: 'USD' };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('generates PDF without optional fields', () => {
    const data = {
      invoiceNumber: 'INV-002', issueDate: '2025-04-01', dueDate: '2025-05-01',
      status: 'draft', lineItems: [
        { description: 'Service', quantity: 1, unitPrice: 5000, amount: 5000, gstRate: 0, cgst: 0, sgst: 0, igst: 0, total: 5000 },
      ],
      subtotal: 5000, taxTotal: 0, total: 5000, isInterState: false, currency: 'INR',
    };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('generates PDF with multiple line items', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      description: `Service Item ${i + 1} - Long description to test text wrapping in the PDF table`,
      quantity: i + 1, unitPrice: 1000 * (i + 1), amount: 1000 * (i + 1),
      gstRate: 18, cgst: 90 * (i + 1), sgst: 90 * (i + 1), igst: 0, total: 1180 * (i + 1),
    }));
    const data = { ...baseData(), lineItems: items };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('generates PDF with UPI payment link when unpaid', () => {
    const data = { ...baseData(), paymentUpiId: 'company@upi' };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('skips UPI link for paid invoices', () => {
    const data = { ...baseData(), paymentUpiId: 'company@upi', status: 'paid' };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('handles overdue status', () => {
    const data = { ...baseData(), status: 'overdue' };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('handles unknown status with fallback color', () => {
    const data = { ...baseData(), status: 'archived' };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('handles UPI link without notes', () => {
    const data = { ...baseData(), paymentUpiId: 'company@upi', notes: undefined };
    const buffer = generateInvoicePDF(data);
    expect(buffer).toBeInstanceOf(Buffer);
  });
});
