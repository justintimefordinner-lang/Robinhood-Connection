// Server-side loader for the VIX/volatility snapshot (data/vix.json), refreshed
// by Claude Code from the Robinhood connector (VIX index + SPY historicals).
// See REFRESH.md → "Refreshing the VIX posture".
import fs from "node:fs";
import path from "node:path";
import type { VixSnapshot } from "./vix";

export const VIX_PATH = path.join(process.cwd(), "data", "vix.json");

export function getVixSnapshot(): VixSnapshot | null {
  try {
    const raw = fs.readFileSync(VIX_PATH, "utf8");
    const parsed = JSON.parse(raw) as VixSnapshot;
    if (parsed?.inputs && typeof parsed.inputs.vix === "number") return parsed;
  } catch {
    /* missing/malformed */
  }
  return null;
}

// VixSnapshot carries no embedded timestamp, and VIX is refreshed on its own
// cadence (manually, via a Claude Code session pulling VIX + SPY data) rather
// than auto_push's regular interval - so snap.meta.generatedAt (the portfolio
// snapshot's timestamp) would be the wrong thing to show as "last updated"
// here; it could be fresh while VIX itself is days stale. The file's own
// mtime is the only honest signal of when this data last changed.
export function getVixUpdatedAt(): string | null {
  try {
    return fs.statSync(VIX_PATH).mtime.toISOString();
  } catch {
    return null;
  }
}
