#!/usr/bin/env python3
"""
Multi-Bank PDF Statement → CSV Extractor.
Supports ICICI Bank (10-column) and Axis Bank (7-column) formats.

Uses pdfplumber table extraction with auto-detection of bank format.

Usage:
  python3 extract_pdf_statement.py <input.pdf> <output.csv>

Exit codes:
  0 = success
  1 = error (message on stderr)

Outputs JSON metadata to stdout on success.
"""
import sys
import re
import csv
import json
import pdfplumber

MONTH_MAP = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
}

# Date patterns
DATE_DDMMYYYY = re.compile(r'^\d{2}-\d{2}-\d{4}$')         # Axis: 16-08-2025
DATE_ICICI = re.compile(r'^\d{1,2}/\w{3}/\d{2,4}$')        # ICICI: 01/Jan/2024


def normalize_date_icici(s):
    if not s:
        return ''
    s = s.strip().replace('\n', ' ')
    s = re.sub(r'(\d{1,2}/\w{3}/\d{2})\s+(\d{2})', r'\g<1>\2', s)
    m = re.match(r'(\d{1,2})/(\w{3})/(\d{4})', s)
    if m:
        return f"{m.group(1).zfill(2)}/{MONTH_MAP.get(m.group(2), '01')}/{m.group(3)}"
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', s)
    if m:
        return s
    return s


def normalize_date_axis(s):
    """Axis dates are dd-mm-yyyy -> convert to dd/mm/yyyy for consistency."""
    if not s:
        return ''
    s = s.strip()
    if DATE_DDMMYYYY.match(s):
        parts = s.split('-')
        return f"{parts[0]}/{parts[1]}/{parts[2]}"
    return s


def parse_amount(s):
    if not s or s.strip() == '' or s.strip() == 'None':
        return 0.0
    s = s.strip().replace('\n', '').replace(',', '').replace(' ', '')
    try:
        return abs(float(s))
    except:
        return 0.0


def clean_remarks(s):
    if not s:
        return ''
    s = s.replace('\n', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def detect_bank(text):
    """Detect bank from first-page text.
    Order matters: check for header-level markers (IFSC Code, account headers)
    before transaction-text markers like UTIB which can appear in any bank's
    transaction descriptions.
    """
    upper = text.upper()
    # ICICI header-level markers — IFSC Code: ICIC is definitive
    if 'IFSC CODE: ICIC' in upper or 'IFSC: ICIC' in upper:
        return 'ICICI Bank'
    # Also check for ICICI in the header area (before transaction table)
    # Split at common table headers to isolate the header section
    header_section = upper
    for marker in ['TRANSACTION REMARKS', 'SL NO', 'SR NO', 'PARTICULARS']:
        idx = upper.find(marker)
        if idx > 0:
            header_section = upper[:idx]
            break
    if 'ICICI' in header_section or 'ICIC0' in header_section:
        return 'ICICI Bank'
    # Axis Bank — check header section to avoid false positives from txn text
    if 'AXIS ACCOUNT NO' in upper or ('AXIS BANK' in upper and 'STATEMENT OF AXIS' in upper):
        return 'Axis Bank'
    if 'UTIB0' in header_section:
        return 'Axis Bank'
    # Other banks
    if 'HDFC' in header_section:
        return 'HDFC Bank'
    elif 'SBI ' in header_section or 'STATE BANK' in header_section:
        return 'State Bank of India'
    elif 'KOTAK' in header_section:
        return 'Kotak Mahindra Bank'
    # Fallback: check full text for bank names
    if 'ICICI' in upper or 'ICIC0' in upper:
        return 'ICICI Bank'
    elif 'HDFC' in upper:
        return 'HDFC Bank'
    elif 'UTIB0' in upper or 'AXIS BANK' in upper:
        return 'Axis Bank'
    elif 'SBI ' in upper or 'STATE BANK' in upper:
        return 'State Bank of India'
    elif 'KOTAK' in upper:
        return 'Kotak Mahindra Bank'
    return 'Unknown'


def extract_metadata(text, bank_name):
    """Extract account number and period from first page text."""
    account_number = ''
    period_from = ''
    period_to = ''

    if bank_name == 'ICICI Bank':
        m = re.search(r'A/C No:\s*(\d+)', text)
        if m:
            account_number = m.group(1)
        m = re.search(r'From\s*([\d/]+)\s*To\s*([\d/]+)', text)
        if m:
            period_from = m.group(1)
            period_to = m.group(2)
    elif bank_name == 'Axis Bank':
        m = re.search(r'Account No\s*:\s*(\d+)', text)
        if m:
            account_number = m.group(1)
        m = re.search(r'From\s*:\s*([\d-]+)\s*To\s*:\s*([\d-]+)', text)
        if m:
            period_from = m.group(1)
            period_to = m.group(2)

    return account_number, period_from, period_to


def extract_icici(pdf):
    """Extract from ICICI Bank 10-column format."""
    transactions = []
    for page in pdf.pages:
        tables = page.extract_tables()
        if not tables:
            continue
        for table in tables:
            for row in table:
                if not row or len(row) < 10:
                    continue
                cell0 = str(row[0] or '').strip()
                if not cell0 or not cell0.split('\n')[0].strip().isdigit():
                    continue
                row_text = ' '.join([str(c) for c in row if c])
                if any(skip in row_text for skip in ['Sl\nNo', 'Value\nDate', 'Withdrawal']):
                    continue

                value_date = normalize_date_icici(str(row[2] or ''))
                txn_date = normalize_date_icici(str(row[3] or ''))
                ref_no = clean_remarks(str(row[5] or ''))
                remarks = clean_remarks(str(row[6] or ''))
                withdrawal = parse_amount(str(row[7] or ''))
                deposit = parse_amount(str(row[8] or ''))
                balance = parse_amount(str(row[9] or ''))

                date = txn_date or value_date
                if not date:
                    continue
                amount = deposit if deposit > 0 else withdrawal
                if amount == 0:
                    continue
                txn_type = 'CR' if deposit > 0 else 'DR'
                description = remarks
                if ref_no and ref_no != 'None' and ref_no not in description:
                    description = f"{remarks} Ref:{ref_no}"

                transactions.append({
                    'date': date,
                    'description': description,
                    'withdrawal': withdrawal,
                    'deposit': deposit,
                    'balance': balance,
                    'type': txn_type,
                    'amount': amount,
                    'reference': ref_no if ref_no != 'None' else '',
                })
    return transactions


def extract_axis(pdf):
    """Extract from Axis Bank 7-column format.
    Columns: [Tran Date, Chq No, Particulars, Debit, Credit, Balance, Init.Br]
    """
    transactions = []
    for page in pdf.pages:
        tables = page.extract_tables()
        if not tables:
            continue
        for table in tables:
            for row in table:
                if not row or len(row) < 6:
                    continue
                date_str = str(row[0] or '').strip()
                if not DATE_DDMMYYYY.match(date_str):
                    continue
                particulars = clean_remarks(str(row[2] or ''))
                debit = parse_amount(str(row[3] or ''))
                credit = parse_amount(str(row[4] or ''))
                balance = parse_amount(str(row[5] or ''))

                if not particulars:
                    continue
                amount = credit if credit > 0 else debit
                if amount == 0:
                    continue
                txn_type = 'CR' if credit > 0 else 'DR'

                transactions.append({
                    'date': normalize_date_axis(date_str),
                    'description': particulars,
                    'withdrawal': debit,
                    'deposit': credit,
                    'balance': balance,
                    'type': txn_type,
                    'amount': amount,
                    'reference': '',
                })
    return transactions


def extract_from_pdf(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        first_text = pdf.pages[0].extract_text() or ''
        bank_name = detect_bank(first_text)
        account_number, period_from, period_to = extract_metadata(first_text, bank_name)

        if bank_name == 'Axis Bank':
            transactions = extract_axis(pdf)
            # Fallback: if Axis parser gets 0, try ICICI format (10-col)
            if not transactions:
                transactions = extract_icici(pdf)
        else:
            # Default to ICICI format (also works for HDFC with similar structure)
            transactions = extract_icici(pdf)
            # Fallback: if ICICI parser gets 0, try Axis format (7-col)
            if not transactions:
                transactions = extract_axis(pdf)

    return {
        'account_number': account_number,
        'period_from': period_from,
        'period_to': period_to,
        'bank_name': bank_name,
        'transactions': transactions,
    }


def save_csv(data, output_path):
    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Cr/Dr', 'Reference'])
        for txn in data['transactions']:
            writer.writerow([
                txn['date'],
                txn['description'],
                f"{txn['withdrawal']:.2f}" if txn['withdrawal'] > 0 else '',
                f"{txn['deposit']:.2f}" if txn['deposit'] > 0 else '',
                f"{txn['balance']:.2f}",
                txn['type'],
                txn.get('reference', ''),
            ])


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 extract_pdf_statement.py <input.pdf> <output.csv>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_csv = sys.argv[2]

    try:
        data = extract_from_pdf(pdf_path)
        save_csv(data, output_csv)

        total_dr = sum(t['withdrawal'] for t in data['transactions'])
        total_cr = sum(t['deposit'] for t in data['transactions'])

        result = {
            'success': True,
            'account_number': data['account_number'],
            'bank_name': data['bank_name'],
            'period_from': data['period_from'],
            'period_to': data['period_to'],
            'transaction_count': len(data['transactions']),
            'total_debit': total_dr,
            'total_credit': total_cr,
            'output_csv': output_csv,
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
