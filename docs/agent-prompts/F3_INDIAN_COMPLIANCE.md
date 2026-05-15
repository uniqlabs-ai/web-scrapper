# Agent F3: Indian Compliance Engine (Wave 2B)

> **Wave 1 Research:** Indian compliance scored **4/10** in our Feature Parity Matrix.
> ClearTax abandoned SMBs (₹50K minimum). QuickBooks exited India entirely.
> Zoho Books is the only competitor with direct GST filing (GSP status).
> This is a MAJOR opportunity if we get compliance right — massive unserved market.
> However, this is Wave 2B (not urgent) because users hit Import → Dashboard → Reports first.

You are the Indian Compliance Agent for `/Users/nidishramakrishnan/Work/founderOS/finance`.

## What We Know (Wave 1 Audit)
- GST returns route: 187 LOC, 3 Prisma calls — **PARTIAL** (has real logic)
- E-invoice route: 101 LOC, 2 Prisma calls — **STUB** (minimal)
- TDS compute: 107 LOC, **0 Prisma calls** — **STUB** (pure calculation, no persistence)
- Compliance calendar: has route, untested
- All routes return 200 on empty DB ✅

## Priority Order
1. **TDS computation** — most commonly needed (every vendor payment)
2. **GST rate engine** — every invoice needs correct CGST/SGST/IGST
3. **Compliance calendar** — passive value, low effort
4. **E-invoicing** — needed for B2B > ₹5Cr turnover (not urgent for early startups)
5. **GSTR filing** — requires GSP integration (future phase)

## Verification Checklist

### TDS Rates (FY 2025-26) — verify in `src/lib/tds.ts`:
| Section | Rate (Individual/HUF) | Rate (Others) | Threshold |
|---------|----------------------|---------------|-----------|
| 194C (Contractor) | 1% | 2% | ₹30,000 single / ₹1,00,000 aggregate |
| 194J (Professional) | 10% | 10% | ₹30,000 |
| 194H (Commission) | 5% | 5% | ₹15,000 |
| 194I (Rent - building) | 10% | 10% | ₹2,40,000 |
| 194I (Rent - equipment) | 2% | 2% | ₹2,40,000 |
| 194A (Interest) | 10% | 10% | ₹40,000 (₹50,000 for seniors) |
| No PAN surcharge | 20% | 20% | — |

### GST Slabs — verify in `src/lib/gst.ts`:
- 0%, 5%, 12%, 18% (most services/SaaS), 28%
- CGST + SGST for intra-state, IGST for inter-state
- Reverse charge mechanism flag

### Compliance Calendar — verify in `src/app/api/compliance/calendar/route.ts`:
- GSTR-1: 11th of following month
- GSTR-3B: 20th of following month
- TDS deposit: 7th of following month
- Advance tax: 15 Jun, 15 Sep, 15 Dec, 15 Mar

## Output
`docs/analysis/COMPLIANCE_AUDIT.md` with pass/fail for each verification point
