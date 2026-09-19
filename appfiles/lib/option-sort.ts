// Column sorting shared by every open-positions table that renders OptionRow.
// CSPs and covered calls share the CSP column set (Ticker · BBσ · DTE · Coll ·
// P/L % · P/L $ · To Strk · Yr %) and the same underlying calcs, so they share
// one sorter; LEAPs/hedges get the long-option column set.
import {
  cspCollateral,
  cspRemainingAnnualized,
  cspToStrike,
  daysToExpiry,
  optionMarketValue,
  optionPnl,
  optionPnlPct,
} from "@/lib/calc";
import type { OptionPosition } from "@/lib/types";

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir };

// Which direction a column starts in when you first tap it — "best first" for
// each metric (biggest collateral, most captured, soonest expiry).
export const CSP_DEFAULT_DIR: Record<string, SortDir> = {
  ticker: "asc", bb: "asc", dte: "asc", coll: "desc", plpct: "desc", pldollar: "desc", tostrike: "asc", yr: "desc",
};
export const LEAP_DEFAULT_DIR: Record<string, SortDir> = {
  ticker: "asc", dte: "asc", value: "desc", plpct: "desc", pldollar: "desc", delta: "desc",
};

export function cspSortVal(o: OptionPosition, key: string): number | string {
  switch (key) {
    case "ticker": return o.symbol;
    case "bb": return o.bbSigma ?? Infinity;
    case "dte": return daysToExpiry(o.expiration);
    case "coll": return cspCollateral(o);
    case "plpct": return optionPnlPct(o);
    case "pldollar": return optionPnl(o);
    // Signed cushion to the strike — cspToStrike flips for short calls, so
    // covered calls sort by the same safe→at-risk meaning the row displays.
    case "tostrike": return cspToStrike(o) ?? Infinity;
    case "yr": return cspRemainingAnnualized(o);
    default: return 0;
  }
}

export function leapSortVal(o: OptionPosition, key: string): number | string {
  switch (key) {
    case "ticker": return o.symbol;
    case "dte": return daysToExpiry(o.expiration);
    case "value": return optionMarketValue(o);
    case "plpct": return optionPnlPct(o);
    case "pldollar": return optionPnl(o);
    case "delta": return o.delta;
    default: return 0;
  }
}

export function sortBy(
  items: OptionPosition[],
  sort: Sort,
  valFn: (o: OptionPosition, key: string) => number | string,
): OptionPosition[] {
  return [...items].sort((a, b) => {
    const va = valFn(a, sort.key);
    const vb = valFn(b, sort.key);
    const aMiss = typeof va === "number" && !isFinite(va);
    const bMiss = typeof vb === "number" && !isFinite(vb);
    if (aMiss || bMiss) return aMiss === bMiss ? 0 : aMiss ? 1 : -1; // missing values always last
    const r = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sort.dir === "asc" ? r : -r;
  });
}

export const sortCsps = (items: OptionPosition[], sort: Sort) => sortBy(items, sort, cspSortVal);
export const sortLeaps = (items: OptionPosition[], sort: Sort) => sortBy(items, sort, leapSortVal);

// Header tap: same column flips direction, a new column starts at its default.
export const nextSort = (s: Sort, key: string, defaults: Record<string, SortDir>): Sort =>
  s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defaults[key] ?? "asc" };
