// On-demand daily chart for one ticker: two years of OHLC from Yahoo Finance's
// public chart endpoint (the bridge has no on-request path — it runs on a
// timer — and the app itself has no Schwab access), every indicator computed
// here, and the dealer-gamma walls folded in from the bridge's snapshot when
// the ticker is one you hold. Example mode returns the synthetic fixture so a
// public demo never reaches out to Yahoo.
//
// GET /api/chart?symbol=GLW → ChartData (lib/chart-indicators.ts) or { error }.
import { isExampleMode } from "@/lib/example-mode";
import { exampleChartData } from "@/lib/example";
import { getSnapshot } from "@/lib/snapshot";
import { buildChartData, type ChartData } from "@/lib/chart-indicators";

export const dynamic = "force-dynamic";

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const CACHE_TTL_MS = 10 * 60 * 1000; // Yahoo rate-limits; a chart doesn't change inside ten minutes
const cache = new Map<string, { at: number; data: ChartData }>();

// Yahoo's chart JSON, only the parts read here.
interface YahooChart {
  chart?: {
    result?: {
      meta?: { longName?: string; shortName?: string; regularMarketPrice?: number; exchangeTimezoneName?: string };
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] };
    }[];
    error?: { code?: string; description?: string } | null;
  };
}

function toDateInZone(tsSec: number, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD; the exchange zone keeps a bar on its own trading day.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(tsSec * 1000));
  } catch {
    return new Date(tsSec * 1000).toISOString().slice(0, 10);
  }
}

async function fetchYahooBars(symbol: string) {
  const yf = symbol.replace(".", "-"); // Schwab's BRK.B is Yahoo's BRK-B
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yf)}?range=2y&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (portfolio-dashboard chart)", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 404) return { error: `No price history for ${symbol}.` } as const;
  if (!res.ok) return { error: `Yahoo Finance answered ${res.status} for ${symbol}.` } as const;
  const json = (await res.json()) as YahooChart;
  const r = json.chart?.result?.[0];
  if (!r || json.chart?.error) return { error: json.chart?.error?.description ?? `No price history for ${symbol}.` } as const;
  const q = r.indicators?.quote?.[0];
  const ts = r.timestamp ?? [];
  if (!q || ts.length === 0) return { error: `No price history for ${symbol}.` } as const;

  const tz = r.meta?.exchangeTimezoneName || "America/New_York";
  const dates: string[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue; // a holiday/partial bar
    dates.push(toDateInZone(ts[i], tz));
    open.push(o);
    high.push(h);
    low.push(l);
    close.push(c);
  }
  if (close.length < 30) return { error: `Not enough history to chart ${symbol}.` } as const;
  return {
    bars: { dates, open, high, low, close },
    companyName: r.meta?.longName || r.meta?.shortName || undefined,
    spotPrice: r.meta?.regularMarketPrice ?? null,
  } as const;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbol") ?? "";
  const symbol = raw.trim().toUpperCase();
  if (!TICKER_RE.test(symbol)) {
    return Response.json({ error: "Enter a ticker like GLW or BRK.B." }, { status: 400 });
  }

  if (await isExampleMode()) return Response.json(exampleChartData(symbol));

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Response.json(hit.data);

  let fetched: Awaited<ReturnType<typeof fetchYahooBars>>;
  try {
    fetched = await fetchYahooBars(symbol);
  } catch (e) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? "Yahoo Finance timed out." : "Couldn't reach Yahoo Finance.";
    return Response.json({ error: msg }, { status: 502 });
  }
  if ("error" in fetched) return Response.json({ error: fetched.error }, { status: 404 });

  // Gamma walls: the bridge writes them onto held equities (≥100 shares) in the
  // snapshot, so a held name gets its walls for free; anything else has none.
  let walls: { callWall: number | null; putWall: number | null; gammaFlip: number | null } = { callWall: null, putWall: null, gammaFlip: null };
  try {
    const snap = await getSnapshot();
    for (const acct of Object.values(snap.data)) {
      const eq = acct.equities.find((e) => e.symbol.toUpperCase() === symbol && e.gamma);
      if (eq?.gamma) {
        walls = { callWall: eq.gamma.callWall, putWall: eq.gamma.putWall, gammaFlip: eq.gamma.flip };
        break;
      }
    }
  } catch {
    // no snapshot — chart without walls
  }

  const data = buildChartData(symbol, fetched.bars, {
    companyName: fetched.companyName,
    spotPrice: fetched.spotPrice,
    ...walls,
    asOf: new Date().toISOString(),
  });
  cache.set(symbol, { at: Date.now(), data });
  return Response.json(data);
}
