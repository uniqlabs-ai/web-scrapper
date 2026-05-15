#!/usr/bin/env python3
"""
Invoice PDF Parser — Supports two formats:
  1. In-house TAX INVOICE  (markers: "TAX INVOICE", "Sl. No.")
  2. Client SERVICE INVOICE (markers: "SERVICE INVOICE", "PURCHASE ORDER#")

Outputs JSON with invoice metadata, line items (zero-value rows excluded),
totals, tax, bank details, and GSTIN.

Usage:
  python scripts/extract_invoice.py path/to/invoice.pdf
  python scripts/extract_invoice.py path/to/invoice.pdf --dry-run
"""

import sys
import json
import re
import os

try:
    import PyPDF2
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "PyPDF2", "-q"])
    import PyPDF2


def extract_text(pdf_path: str) -> str:
    """Extract full text from all pages of a PDF."""
    with open(pdf_path, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
    return text


def detect_format(text: str) -> str:
    """Detect which invoice format we're dealing with."""
    if "SERVICE INVOICE" in text:
        return "service_invoice"
    if "TAX INVOICE" in text:
        return "tax_invoice"
    # Fallback heuristics
    if "PURCHASE ORDER#" in text or "PAYMENT DUE BY" in text:
        return "service_invoice"
    if "Sl. No." in text or "Sl.No." in text:
        return "tax_invoice"
    return "unknown"


def parse_currency_amount(s: str) -> float:
    """Parse a currency amount string like '€ 9,000.00' or '€8,212.60' to float."""
    if not s:
        return 0.0
    cleaned = re.sub(r'[€$₹£\s,]', '', s.strip())
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def detect_currency(text: str) -> str:
    """Detect currency from text."""
    if "€" in text:
        return "EUR"
    if "$" in text:
        return "USD"
    if "£" in text:
        return "GBP"
    if "₹" in text:
        return "INR"
    return "INR"


def currency_symbol(code: str) -> str:
    """Return the regex-escaped currency symbol for a currency code."""
    return {"EUR": "€", "USD": r"\$", "GBP": "£", "INR": "₹"}.get(code, r"[€$£₹]")


def currency_sym_raw(code: str) -> str:
    """Return the raw (unescaped) currency symbol for a currency code."""
    return {"EUR": "€", "USD": "$", "GBP": "£", "INR": "₹"}.get(code, "$")


def extract_date(text: str, pattern: str) -> str:
    """Extract a date near a specific pattern."""
    # Try "Date: 6th February 2026" format
    m = re.search(pattern + r'[:\s]*(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', text, re.IGNORECASE)
    if m:
        raw = m.group(1).strip()
        raw = re.sub(r'(st|nd|rd|th)', '', raw)
        from datetime import datetime
        for fmt in ['%d %B %Y', '%d %b %Y']:
            try:
                return datetime.strptime(raw.strip(), fmt).strftime('%Y-%m-%d')
            except ValueError:
                continue

    # Try "31 January 2026" format
    m = re.search(pattern + r'[:\s]*(\d{1,2}\s+\w+\s+\d{4})', text, re.IGNORECASE)
    if m:
        raw = m.group(1).strip()
        from datetime import datetime
        for fmt in ['%d %B %Y', '%d %b %Y']:
            try:
                return datetime.strptime(raw.strip(), fmt).strftime('%Y-%m-%d')
            except ValueError:
                continue

    # Try "2 March 2026"
    m = re.search(pattern + r'[:\s]*(\d{1,2}\s+\w+\s+\d{4})', text, re.IGNORECASE)
    if m:
        raw = m.group(1).strip()
        from datetime import datetime
        for fmt in ['%d %B %Y']:
            try:
                return datetime.strptime(raw, fmt).strftime('%Y-%m-%d')
            except ValueError:
                continue

    return ""


def extract_tax_invoice(text: str) -> dict:
    """Parse in-house TAX INVOICE format."""
    result = {
        "format": "tax_invoice",
        "invoiceNumber": "",
        "reference": "",
        "purchaseOrder": "",
        "date": "",
        "dueDate": "",
        "currency": detect_currency(text),
        "billedTo": {"name": "", "address": "", "vatNumber": ""},
        "lineItems": [],
        "subtotal": 0,
        "tax": 0,
        "total": 0,
        "bankDetails": {"bank": "", "account": "", "swift": "", "ifsc": ""},
        "gstin": "",
    }

    # Invoice number from "#62/1" or "TAX INVOICE ... #XX"
    m = re.search(r'TAX\s+INVOICE.*?#(\d+)', text[:300])
    if not m:
        m = re.search(r'#(\d+)', text[:200])
    if m:
        result["invoiceNumber"] = m.group(1)

    # Reference
    m = re.search(r'Ref[:\s]+(\S+)', text)
    if m:
        result["reference"] = m.group(1)

    # Date
    result["date"] = extract_date(text, "Date")

    # GSTIN
    m = re.search(r'GSTIN[:\s]+(\S+)', text)
    if m:
        result["gstin"] = m.group(1)

    # Billed to — extract name after "BILLING DETAILS" or "BILL TO"
    m = re.search(r'(?:BILL(?:ING)?\s+(?:DETAILS|TO)[:\s()]*)\s*(.+?)(?:Mobile|Place|Sl\.|DESCRIPTION|Email:)', text, re.DOTALL | re.IGNORECASE)
    if m:
        lines = [l.strip() for l in m.group(1).strip().split('\n') if l.strip()]
        # Remove any lines that are just the header remnants
        lines = [l for l in lines if not re.match(r'^(BILL\s*TO|BILLING\s*DETAILS)[:\s()]*$', l, re.IGNORECASE)]
        if lines:
            result["billedTo"]["name"] = lines[0]
            result["billedTo"]["address"] = ", ".join(lines[1:]) if len(lines) > 1 else ""

    # Build currency-aware regex parts
    sym = currency_symbol(result["currency"])
    sym_raw = currency_sym_raw(result["currency"])

    # Line items — look for rows with currency amounts
    # Pattern: description followed by qty, rate, amount
    line_pattern = re.compile(
        r'(\d+)\s+(.+?)\s+(\d+)\s+' + sym +
        r'\s*([\d,]+\.?\d*)\s+' + sym + r'\s*([\d,]+\.?\d*)',
        re.IGNORECASE
    )

    # Simpler approach: find amounts with currency sign
    amounts_in_text = re.findall(sym + r'\s*([\d,]+\.\d{2})', text)

    # Extract line items between "AMOUNT" header and "Total"
    items_section = re.search(r'AMOUNT\s*\n(.*?)(?:Export|Total|SGST)', text, re.DOTALL)
    if items_section:
        section = items_section.group(1)
        # Find numbered lines: "1 IT Development Services... 25 $360.00 $9,000.00"
        item_matches = re.finditer(
            r'(\d+)\s+(.+?)\s+(\d+)\s+' + sym + r'\s*([\d,]+\.?\d*)\s+' + sym + r'\s*([\d,]+\.?\d*)',
            section
        )
        for im in item_matches:
            amount = parse_currency_amount(im.group(5))
            if amount > 0:
                result["lineItems"].append({
                    "description": im.group(2).strip(),
                    "qty": int(im.group(3)),
                    "rate": parse_currency_amount(im.group(4)),
                    "amount": amount,
                })

    # If no items found, try a more relaxed pattern
    if not result["lineItems"]:
        # Look for "IT Development Services" type lines with amounts
        item_matches = re.finditer(
            r'(\d+)\s+((?:IT|Software|Development|Consulting|Services?|Data)[\w\s()]+?)\s+(\d+)\s+' + sym + r'\s*([\d,]+\.?\d*)\s+' + sym + r'\s*([\d,]+\.?\d*)',
            text, re.IGNORECASE
        )
        for im in item_matches:
            amount = parse_currency_amount(im.group(5))
            if amount > 0:
                result["lineItems"].append({
                    "description": im.group(2).strip(),
                    "qty": int(im.group(3)),
                    "rate": parse_currency_amount(im.group(4)),
                    "amount": amount,
                })

    # Total
    m = re.search(r'Total\s*(?:&\s*Rounded\s*Off)?[^\n]*?' + sym + r'\s*([\d,]+\.?\d*)', text, re.IGNORECASE)
    if m:
        result["total"] = parse_currency_amount(m.group(1))
    elif result["lineItems"]:
        result["total"] = sum(item["amount"] for item in result["lineItems"])

    result["subtotal"] = result["total"]

    # Tax (SGST + CGST)
    sgst = 0
    cgst = 0
    m = re.search(r'SGST\s+' + sym + r'\s*([\d,]+\.?\d*)', text)
    if m:
        sgst = parse_currency_amount(m.group(1))
    m = re.search(r'CGST\s*' + sym + r'?\s*([\d,]+\.?\d*)', text)
    if m:
        cgst = parse_currency_amount(m.group(1))
    result["tax"] = sgst + cgst

    # Bank details
    m = re.search(r'BANK\s*NAME\s*(.+?)(?:Acc|$)', text, re.IGNORECASE)
    if m:
        result["bankDetails"]["bank"] = m.group(1).strip()
    m = re.search(r'Acc\.\s*No\.\s*(\S+)', text)
    if m:
        result["bankDetails"]["account"] = m.group(1)
    m = re.search(r'SWIFT\s*Code\s*(\S+)', text, re.IGNORECASE)
    if m:
        result["bankDetails"]["swift"] = m.group(1)
    m = re.search(r'IFSC\s*CODE\s*(\S+)', text, re.IGNORECASE)
    if m:
        result["bankDetails"]["ifsc"] = m.group(1)

    return result


def extract_service_invoice(text: str) -> dict:
    """Parse client SERVICE INVOICE format."""
    result = {
        "format": "service_invoice",
        "invoiceNumber": "",
        "reference": "",
        "purchaseOrder": "",
        "date": "",
        "dueDate": "",
        "currency": detect_currency(text),
        "billedTo": {"name": "", "address": "", "vatNumber": ""},
        "lineItems": [],
        "subtotal": 0,
        "tax": 0,
        "total": 0,
        "bankDetails": {"bank": "", "account": "", "swift": "", "ifsc": ""},
        "gstin": "",
    }

    # Invoice number from "SERVICE INVOICE #6"
    m = re.search(r'SERVICE\s+INVOICE\s*#\s*(\d+)', text, re.IGNORECASE)
    if m:
        result["invoiceNumber"] = m.group(1)

    # Reference
    m = re.search(r'Ref[:\s]+(\S+)', text)
    if m:
        result["reference"] = m.group(1)

    # Purchase Order
    m = re.search(r'PURCHASE\s+ORDER#?\s*\n?\s*(\S+)', text, re.IGNORECASE)
    if m:
        result["purchaseOrder"] = m.group(1)

    # Invoice Date
    result["date"] = extract_date(text, "Invoice Date")

    # Payment Due By
    result["dueDate"] = extract_date(text, "PAYMENT DUE BY")

    # GSTIN
    m = re.search(r'GSTIN[:\s]+(\S+)', text)
    if m:
        result["gstin"] = m.group(1)

    # VAT number
    m = re.search(r'VAT[:\s]+(\S+)', text)
    if m:
        result["billedTo"]["vatNumber"] = m.group(1)

    # Billed To — client name (appears after the LLP info section)
    # Look for known patterns like "Parity Technologies Ltd." etc.
    m = re.search(r'Cognileap.*?LLP\s+(.+?)(?:\n|62/|\d+/)', text, re.DOTALL)
    if m:
        name = m.group(1).strip().split('\n')[0].strip()
        if name and len(name) > 3:
            result["billedTo"]["name"] = name

    # Try alternative: look for company name between LLP line and address
    if not result["billedTo"]["name"]:
        m = re.search(r'(?:LLP|Ltd)\.\s*\n\s*(.+?)\s*\n', text)
        if m:
            result["billedTo"]["name"] = m.group(1).strip()

    # Line items from DETAILS section
    # Pattern: "IT Development Consultancy\n(Software Engineer)22 €373.30 €8,212.60"
    items_section = re.search(r'DETAILS\s+QUANTITY\s+UNIT\s+PRICE\s+LINE\s+TOTAL\s*\n(.*?)(?:TOTAL|PAYMENT)', text, re.DOTALL | re.IGNORECASE)
    if items_section:
        section = items_section.group(1)
        # Try multi-line description: lines before the qty+price line belong to description
        # Find amounts first
        item_matches = re.finditer(
            r'((?:.+?\n?)+?)(\d+)\s+€(\d[\d,]*\.?\d*)\s+€(\d[\d,]*\.?\d*)',
            section
        )
        for im in item_matches:
            amount = parse_currency_amount(im.group(4))
            if amount > 0:
                desc = re.sub(r'\s+', ' ', im.group(1).strip())
                # Remove leading numbers that might be row indices
                desc = re.sub(r'^\d+\s+', '', desc)
                result["lineItems"].append({
                    "description": desc,
                    "qty": int(im.group(2)),
                    "rate": parse_currency_amount(im.group(3)),
                    "amount": amount,
                })

    # If no items found, try more relaxed pattern
    if not result["lineItems"]:
        item_matches = re.finditer(
            r'([\w\s()]+?)\s*(\d+)\s+€\s*([\d,]+\.?\d*)\s+€\s*([\d,]+\.?\d*)',
            text
        )
        for im in item_matches:
            amount = parse_currency_amount(im.group(4))
            if amount > 0:
                desc = im.group(1).strip()
                if len(desc) > 5 and not desc.upper().startswith('TOTAL'):
                    result["lineItems"].append({
                        "description": re.sub(r'\s+', ' ', desc),
                        "qty": int(im.group(2)),
                        "rate": parse_currency_amount(im.group(3)),
                        "amount": amount,
                    })

    # Total
    m = re.search(r'TOTAL\s+€([\d,]+\.?\d*)', text, re.IGNORECASE)
    if m:
        result["total"] = parse_currency_amount(m.group(1))
    elif result["lineItems"]:
        result["total"] = sum(item["amount"] for item in result["lineItems"])

    result["subtotal"] = result["total"]

    # Bank details
    m = re.search(r'Name\s+of\s+Bank[:\s]+(.+?)(?:\n|E-mail)', text, re.IGNORECASE)
    if m:
        result["bankDetails"]["bank"] = m.group(1).strip()
    m = re.search(r'Account\s+Number[:\s]+(\d+)', text, re.IGNORECASE)
    if m:
        result["bankDetails"]["account"] = m.group(1)
    # SWIFT code — look for "Routing Number (SWIFT Code) ICICINBB002" or "SWIFT Code XXXX"
    m = re.search(r'(?:SWIFT\s*Code|Routing\s+Number)[)\s:]+([A-Z0-9]{8,11})', text, re.IGNORECASE)
    if m:
        result["bankDetails"]["swift"] = m.group(1)
    m = re.search(r'IFSC[:\s]+([A-Z0-9]+)', text, re.IGNORECASE)
    if m:
        result["bankDetails"]["ifsc"] = m.group(1)

    # Payment Reference
    m = re.search(r'Payment\s+Reference[:\s]+(\S+)', text, re.IGNORECASE)
    if m and not result["reference"]:
        result["reference"] = m.group(1)

    return result


def extract_invoice(pdf_path: str) -> dict:
    """Main entry: extract text → detect format → parse."""
    text = extract_text(pdf_path)
    fmt = detect_format(text)

    if fmt == "tax_invoice":
        return extract_tax_invoice(text)
    elif fmt == "service_invoice":
        return extract_service_invoice(text)
    else:
        # Try both and pick the one with more data
        r1 = extract_tax_invoice(text)
        r2 = extract_service_invoice(text)
        if len(r1.get("lineItems", [])) >= len(r2.get("lineItems", [])):
            return r1
        return r2


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_invoice.py <path_to_pdf> [--dry-run]", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    if not os.path.exists(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}))
        sys.exit(1)

    result = extract_invoice(pdf_path)

    if dry_run:
        print("=" * 60)
        print(f"  Format:     {result['format']}")
        print(f"  Invoice #:  {result['invoiceNumber']}")
        print(f"  Reference:  {result['reference']}")
        print(f"  PO #:       {result['purchaseOrder']}")
        print(f"  Date:       {result['date']}")
        print(f"  Due Date:   {result['dueDate']}")
        print(f"  Currency:   {result['currency']}")
        print(f"  GSTIN:      {result['gstin']}")
        print(f"  Billed To:  {result['billedTo']['name']}")
        print(f"  VAT:        {result['billedTo']['vatNumber']}")
        print(f"  Bank:       {result['bankDetails']['bank']}")
        print(f"  SWIFT:      {result['bankDetails']['swift']}")
        print(f"  Account:    {result['bankDetails']['account']}")
        print(f"  IFSC:       {result['bankDetails']['ifsc']}")
        print("-" * 60)
        print(f"  Line Items ({len(result['lineItems'])}):")
        for i, item in enumerate(result["lineItems"], 1):
            print(f"    {i}. {item['description']}")
            print(f"       Qty: {item['qty']}  Rate: {result['currency']} {item['rate']}  Amount: {result['currency']} {item['amount']}")
        print("-" * 60)
        print(f"  Subtotal:   {result['currency']} {result['subtotal']}")
        print(f"  Tax:        {result['currency']} {result['tax']}")
        print(f"  TOTAL:      {result['currency']} {result['total']}")
        print("=" * 60)
    else:
        print(json.dumps(result, indent=2))
