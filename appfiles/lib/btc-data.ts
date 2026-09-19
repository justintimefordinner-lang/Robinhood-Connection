// Latest BTC/USD spot for the home header.
//
// Every other market number in this app arrives as a file the data bridge writes
// (see vix-data.ts, snapshot.ts) — the app itself never calls out. The bridge is a
// Schwab client and has no crypto feed, so there is no file to read here. This
// pulls the price from Yahoo's public no-auth chart endpoint, the same source
// scripts/csp-discover.mjs already uses for candles.
//
// Kept off the critical path as much as a server render allows: the response is
// cached for a minute, the request aborts after two seconds, and ANY failure
// returns null so the header simply omits the line rather than breaking the page.

export interface BtcQuote {
  price: number;
  changePct: number | null; // vs the previous close; null when Yahoo omits it
  asof: string; // ISO
  source: string;
}

const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=5d";
const TIMEOUT_MS = 2000;
const REVALIDATE_S = 60;

// Always live, even in example mode. BTC spot is public market data with nothing
// account-specific in it, so a demo is better served by the real number than by a
// frozen one — the same reasoning lib/mes-data.ts already follows. A failed fetch
// returns null and the header simply omits the line.
export async function getBtcQuote(): Promise<BtcQuote | null> {
  try {
    const res = await fetch(YAHOO_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_S },
    });
    if (!res.ok) return null;
    const result = (await res.json())?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || !isFinite(price) || price <= 0) return null;
    // Yesterday's close = the last daily close before the current session. NOT
    // meta.chartPreviousClose, which on a multi-day range is the close *before the
    // range began* — that would label a five-day move as today's.
    const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter(
      (c: unknown): c is number => typeof c === "number" && isFinite(c),
    );
    const prev = closes.length >= 2 ? closes[closes.length - 2] : null;
    return {
      price,
      changePct: prev && prev > 0 ? (price - prev) / prev : null,
      asof: typeof meta.regularMarketTime === "number"
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      source: "Yahoo Finance",
    };
  } catch {
    // Network down, Yahoo shape changed, timeout — the header drops the line.
    return null;
  }
}

/** Header-sized price: no cents, thousands separated ("$64,000"). */
export const fmtBtc = (price: number) => `$${Math.round(price).toLocaleString("en-US")}`;
