// One loader for the closed-trade files (csp/covered/spreads/leaps/stocks-closed.json),
// scoped to the account being viewed. Each bridge writes its own copy into its data
// dir (base data/ for the first login, data/acct2/ for another, data/manual/
// for hand-closed positions), so a page that unioned them all showed one account's
// realized trades under every other account. Now:
//   * a record is tagged with the account it belongs to — the bridge stamps
//     accountId on newer records; older ones take the single account of the dir
//     they sit in; manual records are matched by the account label in their name;
//   * the result keeps only records of the selected account (or of the accounts in
//     the Combined View). Records that cannot be placed stay visible on broker
//     views, as before, and never on a manual account's.
// Server-only (reads the filesystem and the account cookie).
import fs from "node:fs";
import path from "node:path";
import { dataDirs } from "./data-dirs";
import { getSnapshot } from "./snapshot";
import { COMBINED_ID, getCombineIds, getSelectedAccountId } from "./account";
import { readManualFile } from "./manual-positions";
import type { Snapshot } from "./types";

export interface ClosedDoc<T> {
  meta: { generatedAt: string; source: string; note?: string };
  closed: T[];
}
interface Taggable {
  accountId?: string;
  name?: string;
}

function dirAccountIds(dir: string): string[] {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8")) as Snapshot;
    return Array.isArray(s?.accounts) ? s.accounts.map((a) => a.id) : [];
  } catch {
    return [];
  }
}

/** The manual label a hand-closed record carries: its name is "SYM · <account label>". */
function manualLabel(name: string | undefined): string {
  const parts = (name || "").split(" · ");
  return parts.length > 1 ? parts.slice(1).join(" · ") : "";
}

export async function readClosedForView<T extends Taggable>(name: string, empty: ClosedDoc<T>): Promise<ClosedDoc<T>> {
  const snap = await getSnapshot();
  const selected = await getSelectedAccountId(snap);
  const view = new Set(selected === COMBINED_ID ? await getCombineIds(snap) : [selected]);
  const viewHasBroker = [...view].some((id) => !id.startsWith("manual-"));
  const manualIds = new Map(readManualFile().accounts.map((a) => [a.label, a.id] as const));

  const parts: ClosedDoc<T>[] = [];
  for (const dir of dataDirs()) {
    let doc: ClosedDoc<T>;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ClosedDoc<T>;
    } catch {
      continue; // absent or malformed in this dir
    }
    if (!doc?.closed || !Array.isArray(doc.closed)) continue;
    const isManual = path.basename(dir) === "manual";
    const ids = dirAccountIds(dir);
    const only = !isManual && ids.length === 1 ? ids[0] : null;
    const closed = doc.closed
      .map((r) => {
        if (r.accountId) return r;
        if (isManual) {
          const id = manualIds.get(manualLabel(r.name));
          return id ? { ...r, accountId: id } : r;
        }
        return only ? { ...r, accountId: only } : r;
      })
      .filter((r) => (r.accountId ? view.has(r.accountId) : !isManual && viewHasBroker));
    parts.push({ meta: doc.meta, closed });
  }
  if (parts.length === 0) return empty;
  return { meta: parts[0].meta, closed: parts.flatMap((p) => p.closed) };
}
