// Portfolio-risk thresholds. Kept in one place and copied INTO the computed
// PortfolioRisk result (see lib/portfolio-risk.ts) so the view reads the cap
// from the same object as the values it judges — the UI never hardcodes a
// threshold of its own.
//
// The sector cap is the maximum share of portfolio value (stock value + CSP
// collateral + LEAP / spread capital) in any one sector.
import type { RiskRules } from "./types";

export const RISK_RULES: RiskRules = {
  sector: { maxAllocationPct: 0.3 },
};

// Label the dashboard shows for capital whose ticker has no sector yet — either
// Yahoo returned none, or the bridge hasn't looked it up. Add the ticker to
// `overrides` in data/sectors.json to classify it by hand.
export const UNCLASSIFIED = "Unclassified";
