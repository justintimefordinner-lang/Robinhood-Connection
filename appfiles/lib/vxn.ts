// VXN (Nasdaq-100 Volatility Index) cash-allocation engine — RULE-016 in
// OptionsEvaluator. A second, independent read alongside lib/vix.ts's VIX
// engine, not a replacement for it: kept in its own file on purpose so the
// upstream-mirrored VIX code in lib/vix.ts stays untouched.
//
// The band table below was given directly by the account holder as a
// percentile-matched table (10yrs of Cboe VXN data, matched against the same
// percentile breakpoints as the VIX Cash Allocation framework) — not derived
// here. VXN runs roughly 4 points above VIX structurally (Nasdaq-100
// constituents carry higher implied vol than the broader S&P 500), so every
// threshold is shifted up to match, e.g. VIX's "Extreme Fear" starts at 30,
// VXN's at 35 — same six regime tiers, same rank order, different absolute
// levels.
import type { Regime } from "./vix";

export type VxnRegime = "complacency" | "grind-zone" | "slight-fear" | "fear" | "very-fear" | "extreme-fear";

interface VxnBand {
  low: number;
  high: number;
  regime: VxnRegime;
  label: string;
  cashLow: number;
  cashHigh: number;
}

export const VXN_GUIDE: VxnBand[] = [
  { low: 0, high: 15, regime: "complacency", label: "Complacency", cashLow: 0.4, cashHigh: 0.5 },
  { low: 15, high: 19, regime: "grind-zone", label: "Grind Zone", cashLow: 0.3, cashHigh: 0.4 },
  { low: 19, high: 25, regime: "slight-fear", label: "Slight Fear", cashLow: 0.2, cashHigh: 0.3 },
  { low: 25, high: 30, regime: "fear", label: "Fear", cashLow: 0.1, cashHigh: 0.2 },
  { low: 30, high: 35, regime: "very-fear", label: "Very Fearful", cashLow: 0.05, cashHigh: 0.1 },
  { low: 35, high: Infinity, regime: "extreme-fear", label: "Extreme Fear", cashLow: 0.0, cashHigh: 0.05 },
];

export const VXN_REGIME_LABEL: Record<VxnRegime, string> = {
  complacency: "Complacency",
  "grind-zone": "Grind Zone",
  "slight-fear": "Slight Fear",
  fear: "Fear",
  "very-fear": "Very Fearful",
  "extreme-fear": "Extreme Fear",
};

// Same cool→warm spectrum as VIX's REGIME_COLORS, keyed to VXN's own regime names.
export const VXN_REGIME_COLORS: Record<VxnRegime, { chip: string; bar: string }> = {
  complacency: { chip: "bg-slate-500/15 text-slate-300 ring-slate-500/30", bar: "bg-slate-400" },
  "grind-zone": { chip: "bg-sky-500/15 text-sky-300 ring-sky-500/30", bar: "bg-sky-400" },
  "slight-fear": { chip: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", bar: "bg-emerald-400" },
  fear: { chip: "bg-amber-500/15 text-amber-300 ring-amber-500/30", bar: "bg-amber-400" },
  "very-fear": { chip: "bg-orange-500/15 text-orange-300 ring-orange-500/30", bar: "bg-orange-400" },
  "extreme-fear": { chip: "bg-rose-500/15 text-rose-300 ring-rose-500/30", bar: "bg-rose-400" },
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const rangeStr = (lo: number, hi: number) => `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;

function bandFor(vxn: number): VxnBand {
  return VXN_GUIDE.find((b) => vxn >= b.low && vxn < b.high) ?? VXN_GUIDE[VXN_GUIDE.length - 1];
}

export interface VxnAssessment {
  vxn: number;
  regime: VxnRegime;
  regimeLabel: string;
  targetReservePct: number;
  targetDeployedPct: number;
  cashRange: string;
  investedRange: string;
  marketRead: string;
}

export function assessVxn(vxn: number): VxnAssessment {
  const band = bandFor(vxn);
  const targetReservePct = round((band.cashLow + band.cashHigh) / 2, 4);
  const targetDeployedPct = round(1 - targetReservePct, 4);
  const cashRange = rangeStr(band.cashLow, band.cashHigh);
  const investedRange = rangeStr(1 - band.cashHigh, 1 - band.cashLow);

  return {
    vxn,
    regime: band.regime,
    regimeLabel: VXN_REGIME_LABEL[band.regime],
    targetReservePct,
    targetDeployedPct,
    cashRange,
    investedRange,
    marketRead: `VXN ${vxn.toFixed(1)} — ${band.label}. Nasdaq-100 vol reads ${cashRange} cash / ${investedRange} invested.`,
  };
}

// ---------------------------------------------------------------------------
// VIX-vs-VXN divergence — both tables share the same six regime tiers in the
// same calm→crisis rank order (by construction: VXN's bands are VIX's own,
// percentile-shifted), so comparing rank position directly tells you whether
// Nasdaq/tech-specific fear is running hotter or cooler than the broad
// market. This is informational only — a sector-tilt hint for the account
// holder to weigh, never a suggestion-engine gate (RULE-016 doesn't touch
// internal/suggest, same as RULE-002's VIX band today).
// ---------------------------------------------------------------------------
const VIX_RANK: Record<Regime, number> = {
  "extreme-greed": 0,
  greed: 1,
  "slight-fear": 2,
  fear: 3,
  "very-fear": 4,
  "extreme-fear": 5,
};

const VXN_RANK: Record<VxnRegime, number> = {
  complacency: 0,
  "grind-zone": 1,
  "slight-fear": 2,
  fear: 3,
  "very-fear": 4,
  "extreme-fear": 5,
};

export type DivergenceTilt = "aligned" | "tech-hotter" | "tech-cooler";

export interface VixVxnDivergence {
  tilt: DivergenceTilt;
  gap: number; // rank steps apart, 0-5; sign-agnostic
  note: string;
}

export function compareVixVxn(vixRegime: Regime, vxnRegime: VxnRegime): VixVxnDivergence {
  const vixRank = VIX_RANK[vixRegime];
  const vxnRank = VXN_RANK[vxnRegime];
  const gap = Math.abs(vxnRank - vixRank);

  if (vxnRank === vixRank) {
    return {
      tilt: "aligned",
      gap: 0,
      note: "VIX and VXN are reading the same regime — no differentiated signal between the broad market and Nasdaq/tech right now; the cash target applies evenly across sectors.",
    };
  }

  if (vxnRank > vixRank) {
    return {
      tilt: "tech-hotter",
      gap,
      note: `Nasdaq/tech-specific stress is running hotter than the broad market — VXN sits ${gap} regime step${gap > 1 ? "s" : ""} more fearful than VIX. Worth extra caution specifically on tech/semis-heavy positions even if the broad-market band alone reads calmer. Not financial advice.`,
    };
  }

  return {
    tilt: "tech-cooler",
    gap,
    note: `Broad-market fear is running hotter than Nasdaq/tech specifically — VXN sits ${gap} regime step${gap > 1 ? "s" : ""} calmer than VIX. Tech/semis may be holding up better than the rest of the market, so a broad cash pullback doesn't necessarily need to hit tech-heavy positions as hard. Not financial advice.`,
  };
}
