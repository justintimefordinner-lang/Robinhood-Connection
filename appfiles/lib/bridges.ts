// The Robinhood bridge the app connects/reconnects from Settings.
//
// One Robinhood login per install: a single bridge whose folder is BRIDGE_DIR and
// whose sanitized status lands in the app's own data/ folder. Kept as a list so
// the Settings page and the routes share one lookup. Server-only.
import path from "node:path";
import { BRIDGE_DIR } from "./bridge-dir";
import { DATA_DIR } from "./data-dirs";

export interface BridgeInfo {
  id: string; // url-safe key: "primary"
  label: string; // shown on the Settings connection card
  dir: string; // bridge folder — reauth_inbox/ + credentials.env + .env live here
  statusPath: string; // app-owned robinhood-auth.json the bridge publishes to
}

export function bridges(): BridgeInfo[] {
  return [
    {
      id: "primary",
      label: process.env.ROBINHOOD_BRIDGE_LABEL?.trim() || "Robinhood",
      dir: BRIDGE_DIR,
      statusPath: path.join(DATA_DIR, "robinhood-auth.json"),
    },
  ];
}

/** Look up the bridge by id (defaults to the primary). */
export function bridgeById(id: string | null | undefined): BridgeInfo | undefined {
  const wanted = (id || "primary").trim();
  return bridges().find((b) => b.id === wanted);
}
