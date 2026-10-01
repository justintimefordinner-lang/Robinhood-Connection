// Read-only export of the Robinhood account's holdings, in the row format the
// Schwab dashboard's manual positions take (symbol, size, strike, expiry, what
// was paid or collected — the bridge on that side prices them itself).
//
// The Schwab dashboard calls this when both apps run on the same machine
// (Settings → Manual positions → "Import Robinhood holdings"). Nothing here
// writes or contacts Robinhood: it re-shapes the snapshot this app already
// serves on its pages. Only the bridge's real snapshot is exported — never the
// example dataset — and this app's own manual accounts are left out.
import { readAllJson } from "@/lib/data-dirs";
import { equityValue, freeCashValue, isCashEquivalent } from "@/lib/calc";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const parts = readAllJson<Snapshot>("snapshot.json").filter((s) => s?.data && Array.isArray(s.accounts));
  const accounts = [];
  let generatedAt: string | null = null;
  for (const snap of parts) {
    for (const a of snap.accounts) {
      if (a.type === "manual" || a.id.startsWith("manual-")) continue; // this app's manual accounts
      const d = snap.data[a.id];
      if (!d) continue;
      if (!generatedAt || snap.meta.generatedAt > generatedAt) generatedAt = snap.meta.generatedAt;
      const stocks = d.equities
        .filter((e) => e.qty > 0)
        .map((e) => ({ type: "stock" as const, symbol: e.symbol, qty: e.qty, avgCost: e.avgCost }));
      const options = d.options
        .filter((o) => o.qty > 0)
        .map((o) => ({
          type: "option" as const,
          symbol: o.symbol,
          optionType: o.optionType,
          side: o.side,
          qty: o.qty,
          strike: o.strike,
          expiration: o.expiration,
          premium: Math.abs(o.entryPerShare),
          openedAt: o.openedAt,
        }));
      // Free cash as this app shows it (after collateral for sold puts and spread
      // risk), minus money-market funds — those travel as stock rows above.
      const moneyMarket = d.equities.filter((e) => isCashEquivalent(e.symbol)).reduce((s, e) => s + equityValue(e), 0);
      const cash = Math.max(0, freeCashValue(d.summary, d.equities, d.options) - moneyMarket);
      accounts.push({
        id: a.id,
        mask: a.mask,
        label: a.nickname || "Robinhood",
        cash: Math.round(cash * 100) / 100,
        positions: [...stocks, ...options],
      });
    }
  }
  if (accounts.length === 0) {
    return Response.json({ ok: false, app: "robinhood", error: "No Robinhood data yet — the bridge hasn't written a snapshot." }, { status: 404 });
  }
  return Response.json({ ok: true, app: "robinhood", generatedAt, accounts });
}
