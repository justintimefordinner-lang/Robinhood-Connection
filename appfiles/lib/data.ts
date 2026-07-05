// ---------------------------------------------------------------------------
// SEED DATA — snapshot of the real Robinhood account pulled via the MCP
// connector on 2026-06-14 (prices as of the 2026-06-12 session close).
//
// This is the app's single data source for now. The Robinhood connector is only
// reachable by the assistant, not by a browser app, and Robinhood has no public
// API — so for v1 the live snapshot lives here behind the same types the UI uses.
// Swap this module for a real fetch later; nothing else needs to change.
// ---------------------------------------------------------------------------
import type {
  Account,
  Equity,
  OptionPosition,
  PortfolioSummary,
  ResearchIdea,
  Snapshot,
  ValuePoint,
} from "./types";

// Anchored to the local current day so "days to expiry" and "days held" stay
// accurate against the live Schwab feed (the bridge writes prices in local time).
export const SNAPSHOT_DATE = (() => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
})();
export const PRICES_AS_OF = "2026-06-12 close";

export const accounts: Account[] = [
  {
    id: "5UP15433",
    mask: "••••5433",
    type: "margin",
    brokerageType: "individual",
    isDefault: true,
  },
  {
    id: "826245615",
    mask: "••••5615",
    type: "cash",
    brokerageType: "individual",
    nickname: "Agentic",
    isDefault: false,
  },
];

export const summary: PortfolioSummary = {
  totalValue: 152668.53,
  equityValue: 55175.64,
  optionsValue: 66560.0,
  cryptoValue: 8773.56,
  cash: 22159.33,
  buyingPower: 10270.41,
};

export const equities: Equity[] = [
  { symbol: "NVDA", name: "NVIDIA", qty: 163.08226, avgCost: 112.17, price: 205.19 },
  { symbol: "AAPL", name: "Apple", qty: 16.58478, avgCost: 218.45, price: 291.13 },
  { symbol: "PLTR", name: "Palantir", qty: 29.701212, avgCost: 96.64, price: 127.99 },
  { symbol: "TSLA", name: "Tesla", qty: 6.585652, avgCost: 242.95, price: 406.43 },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", qty: 2.907742, avgCost: 515.86, price: 681.95 },
  { symbol: "AMZN", name: "Amazon", qty: 7.42853, avgCost: 201.92, price: 238.55 },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", qty: 1.97519, avgCost: 556.91, price: 741.75 },
  { symbol: "WMT", name: "Walmart", qty: 11, avgCost: 95.85, price: 121.04 },
  { symbol: "BA", name: "Boeing", qty: 3, avgCost: 182.8, price: 219.05 },
  { symbol: "NDAQ", name: "Nasdaq Inc.", qty: 6.82035, avgCost: 73.31, price: 88.98 },
  { symbol: "SPYG", name: "SPDR S&P 500 Growth ETF", qty: 2, avgCost: 75.1, price: 116.9 },
  { symbol: "JEPQ", name: "JPM Nasdaq Equity Premium", qty: 3.878234, avgCost: 51.57, price: 59.86 },
  { symbol: "ADBE", name: "Adobe", qty: 1, avgCost: 377.96, price: 204.02 },
  { symbol: "TSM", name: "Taiwan Semiconductor", qty: 0.4139, avgCost: 241.6, price: 423.93 },
  { symbol: "SOFI", name: "SoFi Technologies", qty: 10, avgCost: 19.18, price: 16.58 },
  { symbol: "AVGO", name: "Broadcom", qty: 0.32658, avgCost: 306.2, price: 382.07 },
  { symbol: "QQQ", name: "Invesco QQQ Trust", qty: 0.17323, avgCost: 577.27, price: 721.34 },
  { symbol: "REGN", name: "Regeneron", qty: 0.17159, avgCost: 582.78, price: 612.14 },
  { symbol: "RKLB", name: "Rocket Lab", qty: 1, avgCost: 27.88, price: 102.39 },
  { symbol: "TEM", name: "Tempus AI", qty: 1, avgCost: 49.67, price: 47.82 },
  { symbol: "DJT", name: "Trump Media & Technology", qty: 1, avgCost: 39.92, price: 7.8 },
];

export const options: OptionPosition[] = [
  // ----- LEAPS (long-dated long calls) -----
  { id: "ccj-80c-27", kind: "leap-call", symbol: "CCJ", optionType: "call", side: "long", qty: 1, strike: 80, expiration: "2027-01-15", entryPerShare: 28.0, mark: 30.225, delta: 0.7825, theta: -0.0373, iv: 0.6076, breakeven: 110.23 },
  { id: "ccj-80c-28", kind: "leap-call", symbol: "CCJ", optionType: "call", side: "long", qty: 1, strike: 80, expiration: "2028-01-21", entryPerShare: 44.25, mark: 38.975, delta: 0.7811, theta: -0.0221, iv: 0.549, breakeven: 118.98 },
  { id: "hood-80c-28", kind: "leap-call", symbol: "HOOD", optionType: "call", side: "long", qty: 1, strike: 80, expiration: "2028-01-21", entryPerShare: 38.1, mark: 39.8, delta: 0.7572, theta: -0.0264, iv: 0.7299, breakeven: 119.8 },
  { id: "glw-160c-28", kind: "leap-call", symbol: "GLW", optionType: "call", side: "long", qty: 1, strike: 160, expiration: "2028-01-21", entryPerShare: 76.5, mark: 75.375, delta: 0.7458, theta: -0.0527, iv: 0.7435, breakeven: 235.38 },
  { id: "glw-125c-27", kind: "leap-call", symbol: "GLW", optionType: "call", side: "long", qty: 1, strike: 125, expiration: "2027-03-19", entryPerShare: 74.0, mark: 74.75, delta: 0.8204, theta: -0.0646, iv: 0.7711, breakeven: 199.75 },
  { id: "now-86c-28", kind: "leap-call", symbol: "NOW", optionType: "call", side: "long", qty: 1, strike: 86, expiration: "2028-01-21", entryPerShare: 29.7, mark: 41.2, delta: 0.7582, theta: -0.0265, iv: 0.6519, breakeven: 127.2 },
  { id: "googl-395c-27", kind: "leap-call", symbol: "GOOGL", optionType: "call", side: "long", qty: 1, strike: 395, expiration: "2027-12-17", entryPerShare: 85.5, mark: 63.25, delta: 0.5678, theta: -0.077, iv: 0.389, breakeven: 458.25 },
  { id: "unh-300c-27", kind: "leap-call", symbol: "UNH", optionType: "call", side: "long", qty: 1, strike: 300, expiration: "2027-12-17", entryPerShare: 75.33, mark: 134.975, delta: 0.8914, theta: -0.0495, iv: 0.2841, breakeven: 434.98 },
  { id: "pltr-160c-27", kind: "leap-call", symbol: "PLTR", optionType: "call", side: "long", qty: 1, strike: 160, expiration: "2027-12-17", entryPerShare: 58.8, mark: 28.7, delta: 0.5528, theta: -0.0376, iv: 0.5841, breakeven: 188.7 },
  { id: "nvda-175c-27", kind: "leap-call", symbol: "NVDA", optionType: "call", side: "long", qty: 1, strike: 175, expiration: "2027-12-17", entryPerShare: 46.21, mark: 64.65, delta: 0.7489, theta: -0.0436, iv: 0.4635, breakeven: 239.65 },
  { id: "spy-710c-27", kind: "leap-call", symbol: "SPY", optionType: "call", side: "long", qty: 1, strike: 710, expiration: "2027-01-15", entryPerShare: 16.65, mark: 69.655, delta: 0.7002, theta: -0.1346, iv: 0.1904, breakeven: 779.66 },
  // ----- Protective long put (hedge) -----
  { id: "nvda-170p-27", kind: "leap-put-hedge", symbol: "NVDA", optionType: "put", side: "long", qty: 1, strike: 170, expiration: "2027-12-17", entryPerShare: 33.31, mark: 22.5, delta: -0.2443, theta: -0.0265, iv: 0.4632, breakeven: 147.5 },

  // ----- Cash-secured puts (short puts) -----
  { id: "iren-51p", kind: "csp", symbol: "IREN", optionType: "put", side: "short", qty: 4, strike: 51, expiration: "2026-06-26", entryPerShare: 2.1, mark: 1.58, delta: -0.1981, theta: -0.1523, iv: 1.2056, breakeven: 49.42, chanceOfProfitShort: 0.782 },
  { id: "glw-160p", kind: "csp", symbol: "GLW", optionType: "put", side: "short", qty: 1, strike: 160, expiration: "2026-06-26", entryPerShare: 5.9, mark: 3.375, delta: -0.2033, theta: -0.3292, iv: 0.8575, breakeven: 156.62, chanceOfProfitShort: 0.793 },
  { id: "ccj-107p", kind: "csp", symbol: "CCJ", optionType: "put", side: "short", qty: 1, strike: 107, expiration: "2026-07-02", entryPerShare: 3.77, mark: 8.775, delta: -0.6463, theta: -0.1305, iv: 0.5869, breakeven: 98.22, chanceOfProfitShort: 0.565 },
];

// Illustrative portfolio value trend (no real history is exposed by the
// connector). Replace with get_portfolio_historicals when wired to a backend.
export const valueHistory: ValuePoint[] = [
  { label: "Jul", value: 98000 },
  { label: "Aug", value: 102500 },
  { label: "Sep", value: 99800 },
  { label: "Oct", value: 108200 },
  { label: "Nov", value: 115000 },
  { label: "Dec", value: 112300 },
  { label: "Jan", value: 121000 },
  { label: "Feb", value: 128400 },
  { label: "Mar", value: 134900 },
  { label: "Apr", value: 142000 },
  { label: "May", value: 148500 },
  { label: "Jun", value: 152668.53 },
];

// ----- "Agentic" cash account (826245615): essentially empty -----
export const agenticSummary: PortfolioSummary = {
  totalValue: 1000,
  equityValue: 0,
  optionsValue: 0,
  cryptoValue: 0,
  cash: 1000,
  buyingPower: 1000,
};

export const agenticHistory: ValuePoint[] = [
  { label: "May", value: 0 },
  { label: "Jun", value: 1000 },
];

// Fallback snapshot used when data/snapshot.json doesn't exist yet. Once Claude
// Code writes a real snapshot via the MCP connector, that file wins.
export const seedSnapshot: Snapshot = {
  meta: { generatedAt: "2026-06-14T16:00:00Z", pricesAsOf: PRICES_AS_OF, source: "seed" },
  accounts,
  data: {
    "5UP15433": { summary, equities, options, valueHistory },
    "826245615": { summary: agenticSummary, equities: [], options: [], valueHistory: agenticHistory },
  },
};

// Starter research ideas. This is a scaffold — the Research tab is where the
// screening logic and documentation will be built out.
export const researchIdeas: ResearchIdea[] = [
  { symbol: "AMD", name: "Advanced Micro Devices", strategy: "leap", thesis: "AI accelerator #2; pullback to 200DMA.", signal: "Delta-70 LEAP ~7% of spot", watch: true },
  { symbol: "SOFI", name: "SoFi Technologies", strategy: "csp", thesis: "Already held; sell puts to add lower.", signal: "IV rank 58%", watch: true },
  { symbol: "MU", name: "Micron", strategy: "csp", thesis: "Memory upcycle; elevated premium.", signal: "30-delta put ~3.2% / mo", watch: false },
  { symbol: "CRM", name: "Salesforce", strategy: "leap", thesis: "FCF compounder; oversold.", signal: "Delta-75 LEAP", watch: false },
  { symbol: "UBER", name: "Uber", strategy: "csp", thesis: "Cash-flow inflection; support at 80.", signal: "IV rank 41%", watch: false },
];
