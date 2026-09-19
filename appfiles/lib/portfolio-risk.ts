// Sector-concentration rollup for the whole portfolio (every account across every
// bridge). Pure — no fs, no React — so it can be computed in any server component
// from the merged snapshot plus the sector map.
//
// Capital per ticker reuses computeHoldings (stock value + CSP collateral + LEAP
// / hedge market value + spread defined risk), so a sector's dollar figure is
// exactly the sum of the Holdings table rows that feed it.
import type { PortfolioRisk, SectorBucket, SectorMap, Snapshot } from "./types";
import { computeHoldings } from "./holdings";
import { RISK_RULES, UNCLASSIFIED } from "./risk-rules";

/** Sector buckets from a capital-per-ticker map. */
export function bucketBySector(
  capitalByTicker: Map<string, number>,
  sectors: SectorMap,
  portfolioValue: number,
): SectorBucket[] {
  const buckets = new Map<string, SectorBucket>();
  for (const [symbol, value] of capitalByTicker) {
    if (value <= 0) continue;
    const sector = sectors[symbol.toUpperCase()] ?? UNCLASSIFIED;
    const b: SectorBucket = buckets.get(sector) ?? {
      sector,
      value: 0,
      pct: 0,
      over: false,
      unclassified: sector === UNCLASSIFIED,
      tickers: [],
    };
    b.value += value;
    b.tickers.push({ symbol, value });
    buckets.set(sector, b);
  }
  const out = [...buckets.values()];
  for (const b of out) {
    b.pct = portfolioValue > 0 ? b.value / portfolioValue : 0;
    b.over = b.pct > RISK_RULES.sector.maxAllocationPct;
    b.tickers.sort((a, z) => z.value - a.value);
  }
  return out.sort((a, z) => z.value - a.value);
}

export function computePortfolioRisk(snap: Snapshot, sectors: SectorMap): PortfolioRisk {
  const capital = new Map<string, number>();
  let portfolioValue = 0;
  let accountCount = 0;

  for (const account of snap.accounts) {
    const data = snap.data[account.id];
    if (!data) continue;
    accountCount += 1;
    portfolioValue += data.summary.totalValue;
    for (const row of computeHoldings(data)) {
      capital.set(row.symbol, (capital.get(row.symbol) ?? 0) + row.value);
    }
  }

  return {
    portfolioValue,
    accountCount,
    sectors: bucketBySector(capital, sectors, portfolioValue),
    rules: RISK_RULES,
  };
}
