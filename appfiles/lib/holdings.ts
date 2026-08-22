// Capital-per-ticker rollup shared by the Portfolio page (Holdings table) and the
// Brief, so "underweight" means the identical thing on both surfaces. Pure — no fs,
// no React — safe to import from server components and client components alike.
import type { AccountData } from "./types";
import {
  cspCollateral,
  equityValue,
  isCashEquivalent,
  isCashSettledIndex,
  optionMarketValue,
  spreadRiskCapital,
} from "./calc";

export interface HoldingBreakout {
  key: string;
  label: string;
  value: number;
  route: string;
}

export interface HoldingRow {
  symbol: string;
  value: number;
  pct: number; // 0..1, share of the whole account
  breakout: HoldingBreakout[];
}

// Concentration thresholds, as a share of total account value.
export const HEAVY_PCT = 0.1; // > 10% — over-concentrated (orange row)
export const LIGHT_PCT = 0.05; // < 5% — lightly held (green row, concentration signal)
export const UNDERWEIGHT_PCT = 0.085; // < 8.5% — "room to add"; drives the CSP overlap tag + the Brief's green flag

// Per-strategy label + drill-in route for the expandable breakout rows.
const STRAT_META: Record<string, { label: string; route: string }> = {
  stock: { label: "Stock", route: "/stocks" },
  csp: { label: "CSPs", route: "/options/csp" },
  leap: { label: "LEAPs", route: "/options/leap" },
  spread: { label: "Spreads", route: "/options/spread" },
};

// Capital per ticker across EVERY strategy — stock value + CSP collateral +
// LEAP/hedge market value + spread defined risk — as a share of the whole
// account. (Covered calls add nothing; the shares are already in stock value.)
// Sorted by capital, each ticker keeping its per-strategy split for the drill-in.
export function computeHoldings(data: AccountData): HoldingRow[] {
  const { equities, options, summary } = data;
  const byTicker = new Map<string, Map<string, number>>();
  const addCap = (sym: string, key: string, v: number) => {
    if (v <= 0) return;
    const m = byTicker.get(sym) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + v);
    byTicker.set(sym, m);
  };
  for (const e of equities) if (!isCashEquivalent(e.symbol)) addCap(e.symbol, "stock", equityValue(e));
  for (const o of options) {
    if (o.kind === "leap-call" || o.kind === "leap-put-hedge") addCap(o.symbol, "leap", optionMarketValue(o));
    else if (o.kind === "csp" && !isCashSettledIndex(o.symbol)) addCap(o.symbol, "csp", cspCollateral(o));
  }
  for (const sym of new Set(
    options.filter((o) => o.kind === "put-spread" || o.kind === "call-spread").map((o) => o.symbol),
  )) {
    addCap(
      sym,
      "spread",
      spreadRiskCapital(
        options.filter((o) => o.symbol === sym && (o.kind === "put-spread" || o.kind === "call-spread")),
      ),
    );
  }
  return [...byTicker.entries()]
    .map(([symbol, m]) => {
      const value = [...m.values()].reduce((s, v) => s + v, 0);
      const breakout = [...m.entries()]
        .map(([key, v]) => ({ key, label: STRAT_META[key]?.label ?? key, value: v, route: STRAT_META[key]?.route ?? "/" }))
        .sort((a, b) => b.value - a.value);
      return { symbol, value, pct: summary.totalValue > 0 ? value / summary.totalValue : 0, breakout };
    })
    .sort((a, b) => b.value - a.value);
}

// Upper-cased tickers sitting under the underweight threshold — room to add.
// Returned as a plain array so it can cross a server→client component boundary
// (a Set is not serializable); the consumer rebuilds a Set for lookups.
export function underweightTickers(rows: HoldingRow[]): string[] {
  return rows.filter((r) => r.pct < UNDERWEIGHT_PCT).map((r) => r.symbol.toUpperCase());
}
