// Example-mode Morning Brief (AmReport). Mirrors what am_report.py produces so
// the Briefing tab and the home CSP-board flags fully populate in a demo. Board
// names are drawn from the approved universe and deliberately overlap the example
// holdings (SOFI/INTC/MU are held & underweight → overlap green) while others
// (AVGO/TSM/LRCX) are unheld with score > 80 → high-conviction green.
import type {
  AmReport,
  AmBoardRow,
  AmChain,
  AmLadderLeg,
  AmTrend,
  AmGamma,
  AmVrpGroup,
  AmMover,
  Vrp,
  Tier,
} from "./am-report-types";

// Dates derive from today so the board never reads as stale — expirations stay in
// the future and the days-to-expiry on every ladder rung stays sensible.
const DAY_MS = 86_400_000;
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

// IV/RV pair per VRP bucket so vrpRatio agrees with the label.
const VRP_IVRV: Record<Vrp, [number, number]> = {
  rich: [0.42, 0.32],
  fair: [0.35, 0.33],
  thin: [0.28, 0.34],
  "n/a": [0.3, 0.3],
};

function chainFor(last: number): AmChain {
  const strike = Math.round(last * 0.9);
  const mark = +(last * 0.022).toFixed(2);
  const premPct = +((mark / last) * 100).toFixed(2);
  return { dte: 30, exp: isoDay(30), strike, delta: -0.3, mark, premPct, annPct: +((premPct * 365) / 30).toFixed(1), oi: 4200, spreadPct: 1.4 };
}

function ladderFor(last: number): AmLadderLeg[] {
  const leg = (dTarget: number, dAbs: number, dte: number, exp: string, sigma: number, zone: string): AmLadderLeg => {
    const strike = +(last * (1 - dAbs * 0.5)).toFixed(last < 20 ? 1 : 0);
    const mark = +(last * 0.02 * (dAbs / 0.3)).toFixed(2);
    const premPct = +((mark / last) * 100).toFixed(2);
    return { dTarget, strike, delta: -dAbs, mark, premPct, annPct: +((premPct * 365) / dte).toFixed(1), oi: 3200, spreadPct: 1.5, dte, exp, bbSigma: sigma, pctB: 0.3, bbZone: zone };
  };
  return [
    leg(16, 0.16, 14, isoDay(14), -1.9, "lower"),
    leg(30, 0.3, 30, isoDay(30), -1.0, "lower-mid"),
    leg(45, 0.45, 45, isoDay(45), -0.3, "mid"),
  ];
}

function trendFor(score: number): AmTrend {
  return {
    uptrend: score >= 60,
    ret18mo: +((score / 100) * 0.8).toFixed(2),
    above200: score >= 55,
    rising200: score >= 60,
    bollUp: score >= 70,
    pctAbove200: +((score - 50) * 0.6).toFixed(1),
    strength: score,
  };
}

function gammaFor(last: number): AmGamma {
  return { flip: Math.round(last), callWall: Math.round(last * 1.08), putWall: Math.round(last * 0.92), net: "pos" };
}

interface RowOpts {
  group: string;
  beta?: number;
  ivr?: number;
  relVol?: number;
  move?: number;
  er?: { date: string; days: number; spans: boolean };
}

function mkRow(sym: string, last: number, score: number, tier: Tier, vrp: Vrp, o: RowOpts): AmBoardRow {
  const [iv, rv] = VRP_IVRV[vrp];
  return {
    sym,
    skip: false,
    fails: [],
    trend: trendFor(score),
    chain: chainFor(last),
    ladder: ladderFor(last),
    iv,
    rv,
    vrp,
    vrpRatio: +(iv / rv).toFixed(2),
    beta: o.beta ?? 1.2,
    gamma: gammaFor(last),
    score,
    tier,
    group: o.group,
    move: o.move ?? 0,
    last,
    relVol: o.relVol ?? 1.1,
    ivr: o.ivr ?? 45,
    ivrSamples: 250,
    erDays: o.er?.days ?? null,
    erDate: o.er?.date ?? null,
    erSpansPut: o.er?.spans ?? false,
  };
}

const board: AmBoardRow[] = [
  mkRow("NVDA", 214.72, 88, "S", "rich", { group: "AI / Semis", beta: 1.7, ivr: 58, relVol: 1.4, move: 1.7 }),
  mkRow("AVGO", 368.45, 84, "S", "rich", { group: "AI / Semis", beta: 1.4, ivr: 52, relVol: 1.2, move: 0.9 }),
  mkRow("TSM", 418.95, 82, "A", "fair", { group: "AI / Semis", beta: 1.1, ivr: 41, relVol: 1.0, move: 2.2, er: { date: isoDay(29), days: 29, spans: true } }),
  mkRow("MU", 966.78, 76, "A", "rich", { group: "Memory", beta: 1.5, ivr: 61, relVol: 1.6, move: 1.85 }),
  mkRow("LRCX", 314.0, 81, "A", "fair", { group: "Semi Equip", beta: 1.3, ivr: 47, relVol: 1.1, move: 0.6 }),
  mkRow("SOFI", 18.91, 71, "A", "rich", { group: "Fintech", beta: 1.6, ivr: 55, relVol: 1.3, move: 2.1 }),
  mkRow("INTC", 90.07, 58, "B", "fair", { group: "Semis", beta: 1.0, ivr: 38, relVol: 0.9, move: -1.4 }),
  mkRow("GLW", 149.84, 63, "B", "fair", { group: "Optical", beta: 1.1, ivr: 44, relVol: 1.0, move: 0.4 }),
];

function groupOf(group: string): AmVrpGroup {
  const members = board.filter((m) => m.group === group);
  const rich = members.filter((m) => m.vrp === "rich").length;
  const fair = members.filter((m) => m.vrp === "fair").length;
  const thin = members.filter((m) => m.vrp === "thin").length;
  const richest = [...members].sort((a, b) => (b.vrpRatio ?? 0) - (a.vrpRatio ?? 0))[0]?.sym ?? "";
  return { group, n: members.length, rich, fair, thin, richest, members };
}

const movers: { gainers: AmMover[]; losers: AmMover[] } = {
  gainers: [
    { sym: "TSM", move: 0.71, last: 418.95, vrp: "fair", uptrend: true, gated: false, group: "AI / Semis" },
    { sym: "SOFI", move: 5.52, last: 18.91, vrp: "rich", uptrend: true, gated: false, group: "Fintech" },
    { sym: "MU", move: -0.77, last: 966.78, vrp: "rich", uptrend: true, gated: false, group: "Memory" },
  ],
  losers: [
    { sym: "INTC", move: -2.24, last: 90.07, vrp: "fair", uptrend: false, gated: false, group: "Semis" },
    { sym: "CCL", move: 1.42, last: 25.73, vrp: "thin", uptrend: false, gated: true, group: "Travel" },
  ],
};

export const exampleAmReport: AmReport = {
  meta: {
    asOf: new Date().toISOString(),
    source: "example",
    count: 36,
    passed: board.length,
    earningsLoaded: true,
    marketOpen: true,
    ladderAsOf: new Date(Date.now() - 60_000).toISOString(),
    ladderNextAt: new Date(Date.now() + 4 * 60_000).toISOString(),
    ladderCadence: "base",
  },
  regime: {
    vix: 15.13,
    vix3m: 18.5,
    termStructure: "contango",
    band: "Slight Fear",
    cashRange: "20–25%",
    volWeather: "deploy",
    futures: [
      { sym: "ES", pct: 0.3 },
      { sym: "NQ", pct: 0.52 },
    ],
    s5fi: 58.1,
    s5fiSlopeWk: -0.35,
  },
  board,
  movers,
  vrpGroups: [groupOf("AI / Semis"), groupOf("Memory"), groupOf("Semi Equip"), groupOf("Fintech"), groupOf("Semis"), groupOf("Optical")],
  landmines: [
    { sym: "AMAT", erDate: isoDay(5), erDays: 5 },
    { sym: "ADI", erDate: isoDay(7), erDays: 7 },
  ],
  steerClear: [
    { sym: "CCL", fails: ["below 200DMA", "downtrend"] },
    { sym: "AA", fails: ["thin OI", "wide spreads"] },
    { sym: "HL", fails: ["IV too low", "below 200DMA"] },
  ],
};
