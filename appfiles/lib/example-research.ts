// Example-mode research feed (ResearchFile, normally written by research_sync.py).
// Populates the Research tab's grid, vehicle tabs, and covered-call candidates.
// Keyed by approved tickers; a few names (AAPL/CLS) lean toppy so the Covered tab
// surfaces them against the example holdings.
import type { IndicatorSnapshot, Setup, TickerData, ResearchFile } from "./research-types";

function ind(price: number, pctB: number, rsi: number, macdBull: boolean): IndicatorSnapshot {
  const sma20 = +(price * (1.02 - pctB * 0.04)).toFixed(2);
  const band = price * 0.06;
  return {
    price,
    sma20,
    bbUpper: +(sma20 + band).toFixed(2),
    bbLower: +(sma20 - band).toFixed(2),
    pctB,
    rsi,
    macd: macdBull ? 0.8 : -0.6,
    signal: macdBull ? 0.5 : -0.3,
    hist: macdBull ? 0.3 : -0.3,
    histPrev: macdBull ? 0.1 : -0.1,
    macdBullish: macdBull,
    macdBearish: !macdBull,
    freshBullCross: false,
    freshBearCross: false,
  };
}

function mkTicker(price: number, pctB: number, rsi: number, macdBull: boolean, bullScore: number, bearScore: number): TickerData {
  const setup: Setup = {
    bullScore,
    bearScore,
    vehicleScores: {
      CSP: bullScore,
      LEAP: Math.round(bullScore * 0.9),
      "Bull Put Spread": Math.round(bullScore * 0.95),
      "Bear Call Spread": bearScore,
    },
    bull: {
      sub: { bb: +((1 - pctB) * 0.9).toFixed(2), rsi: +(Math.max(0, (55 - rsi) / 55)).toFixed(2), macd: macdBull ? 0.9 : 0.3 },
      bbLow: pctB < 0.2,
      rsiOversold: rsi < 35,
      macdBullish: macdBull,
    },
    bear: {
      sub: { bb: +(pctB * 0.9).toFixed(2), rsi: +(Math.max(0, (rsi - 45) / 55)).toFixed(2), macd: macdBull ? 0.2 : 0.8 },
      bbHigh: pctB > 0.8,
      rsiOverbought: rsi > 65,
      macdBearish: !macdBull,
    },
    signal:
      Math.max(bullScore, bearScore) >= 60
        ? {
            direction: bullScore >= bearScore ? "bullish" : "bearish",
            strength: Math.max(bullScore, bearScore) >= 75 ? "strong" : "forming",
            score: Math.max(bullScore, bearScore),
            vehicles: bullScore >= bearScore ? ["CSP", "LEAP", "Bull Put Spread"] : ["Bear Call Spread"],
          }
        : null,
  };
  return { ...ind(price, pctB, rsi, macdBull), setup };
}

// [price, pctB, rsi, macdBull, bullScore, bearScore]
const T: Record<string, [number, number, number, boolean, number, number]> = {
  NVDA: [214.72, 0.62, 61, true, 82, 24],
  AVGO: [368.45, 0.55, 58, true, 84, 22],
  TSM: [418.95, 0.48, 55, true, 78, 26],
  MU: [966.78, 0.66, 63, true, 80, 30],
  LRCX: [314.0, 0.44, 52, true, 81, 28],
  AMAT: [492.32, 0.38, 48, true, 66, 34],
  SOFI: [18.91, 0.7, 64, true, 74, 32],
  INTC: [90.07, 0.18, 38, false, 44, 58],
  GLW: [149.84, 0.5, 54, true, 63, 30],
  CLS: [296.55, 0.92, 74, true, 40, 71],
  AAPL: [309.35, 0.86, 69, true, 38, 66],
  GOOGL: [344.82, 0.58, 57, true, 70, 28],
  AMZN: [258.63, 0.6, 59, true, 69, 27],
  CEG: [272.88, 0.34, 46, false, 52, 41],
  IREN: [41.88, 0.28, 42, false, 48, 47],
};

const tickers: ResearchFile["tickers"] = Object.fromEntries(
  Object.entries(T).map(([sym, a]) => [sym, mkTicker(...a)] as [string, TickerData]),
);

const signals: ResearchFile["signals"] = Object.entries(tickers)
  .map(([symbol, t]) => {
    if ("error" in t || !t.setup.signal) return null;
    const s = t.setup.signal;
    return { symbol, direction: s.direction, strength: s.strength, score: s.score, vehicles: s.vehicles, price: t.price, pctB: t.pctB, rsi: t.rsi, hist: t.hist };
  })
  .filter((x): x is NonNullable<typeof x> => x !== null)
  .sort((a, b) => b.score - a.score);

export const exampleResearch: ResearchFile = {
  meta: { asOf: "2026-06-18T20:00:00Z", count: Object.keys(tickers).length, params: { bbPeriod: 20, rsiPeriod: 14 } },
  tickers,
  signals,
};
