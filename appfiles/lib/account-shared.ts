// Client-safe account helpers (no server-only imports like next/headers), so
// both the client AccountSwitcher and the server account resolver can use them.
import type { Account } from "./types";

export const ACCOUNT_COOKIE = "account";

/** Display label for an account, e.g. "Agentic" or "Traditional IRA". */
export function accountLabel(a: Account): string {
  if (a.nickname) return a.nickname;
  return a.brokerageType
    .split(" ")
    .map((word) => (word.toLowerCase() === "ira" ? "IRA" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}
