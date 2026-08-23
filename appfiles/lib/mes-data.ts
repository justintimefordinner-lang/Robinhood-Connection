// MES — Micro E-mini S&P 500 daily direction tracker.
//
// Quotes the E-mini (ES=F) rather than MES=F: both track the same index (MES is
// simply a fifth of the contract size), so the slope is identical, but ES is the
// liquid benchmark with clean daily history where MES=F's candles are gappy.
//
// Same shape as lib/btc-data.ts — Yahoo's public no-auth chart endpoint, cached for
// a few minutes, a short timeout, and null on ANY failure so the caller just omits
// the section rather than breaking the page.

export interface MesDaily {
  date: string; // ISO yyyy-mm-dd
  close: number;
}

export interface MesQuote {
  last: number; // latest price
  changePct: number | null; // vs the prior session close
  daily: MesDaily[]; // the last N sessions, oldest → newest
  slope: number; // least-squares points/day over `daily`
  slopePct: number; // slope as % of the mean level, for scale-free reading
  asof: string; // ISO
  source: string;
}

const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/ES=F?interval=1d&range=1mo";
const TIMEOUT_MS = 2500;
const REVALIDATE_S = 300;
const SESSIONS = 5; // trading days to plot

/** Least-squares slope of y over evenly spaced x (0,1,2,…) — points per session. */
function leastSquaresSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (ys[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export async function getMesQuote(): Promise<MesQuote | null> {
  try {
    const res = await fetch(YAHOO_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_S },
    });
    if (!res.ok) return null;
    const result = (await res.json())?.chart?.result?.[0];
    const meta = result?.meta;
    const stamps: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    if (!meta || stamps.length === 0 || closes.length === 0) return null;

    // Pair timestamps with closes, dropping the holes Yahoo leaves on holidays.
    const series: MesDaily[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const c = closes[i];
      if (typeof c !== "number" || !isFinite(c)) continue;
      series.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    const daily = series.slice(-SESSIONS);
    if (daily.length < 2) return null;

    const ys = daily.map((d) => d.close);
    const slope = leastSquaresSlope(ys);
    const meanLevel = ys.reduce((s, v) => s + v, 0) / ys.length;
    const last = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : ys[ys.length - 1];
    const prev = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null;

    return {
      last,
      changePct: prev && prev > 0 ? (last - prev) / prev : null,
      daily,
      slope,
      slopePct: meanLevel > 0 ? (slope / meanLevel) * 100 : 0,
      asof: typeof meta.regularMarketTime === "number"
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      source: "Yahoo Finance · ES=F",
    };
  } catch {
    // Network down, Yahoo shape changed, timeout — the caller drops the section.
    return null;
  }
}

/** Index-sized level: no cents ("7,691"). */
export const fmtMes = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
