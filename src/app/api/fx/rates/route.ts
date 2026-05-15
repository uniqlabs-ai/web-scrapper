import { NextRequest, NextResponse } from "next/server";
import { CURRENCIES, STATIC_RATES } from "@/lib/currency";
import { log, toLogError } from "@/lib/logger";

/**
 * GET /api/fx/rates — Get exchange rates and conversion
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || "USD";
    const to = searchParams.get("to") || "INR";
    const amount = Number(searchParams.get("amount") || 1);

    // Try to fetch live rates from a free API
    const rates = { ...STATIC_RATES };
    let isLive = false;

    try {
      const res = await fetch(
        `https://api.exchangerate-api.com/v4/latest/INR`,
        { next: { revalidate: 3600 } } // Cache 1 hour
      );
      if (res.ok) {
        const data = await res.json();
        // API returns rates FROM INR TO others, we need the inverse
        for (const [code, rate] of Object.entries(data.rates as Record<string, number>)) {
          if (STATIC_RATES[code] !== undefined) {
            rates[code] = Math.round((1 / rate) * 10000) / 10000;
          }
        }
        rates.INR = 1;
        isLive = true;
      }
    } catch {
      // Fallback to static rates
    }

    // Conversion
    const fromRate = rates[from] || 1;
    const toRate = rates[to] || 1;
    const convertedAmount = amount * (fromRate / toRate);

    return NextResponse.json({
      from,
      to,
      amount,
      converted: Math.round(convertedAmount * 100) / 100,
      rate: Math.round((fromRate / toRate) * 10000) / 10000,
      isLive,
      lastUpdated: new Date().toISOString(),
      allRates: Object.entries(rates).map(([code, rateToINR]) => ({
        code,
        name: CURRENCIES.find((c) => c.code === code)?.name || code,
        symbol: CURRENCIES.find((c) => c.code === code)?.symbol || code,
        rateToINR: rateToINR,
      })),
    });
  } catch (error) {
    log.error("FX rates error", { module: "fx", action: "rates", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to fetch rates" }, { status: 500 });
  }
}
