// Server-side loader for the live portfolio snapshot. Import only from server
// components and route handlers (it touches the filesystem).
// Reads data/snapshot.json (written locally by the Python bridge) and falls
// back to the bundled example dataset when that file is absent or unreadable.
// The real snapshot is generated on the host and never ships in the repo.
import fs from "node:fs";
import path from "node:path";
import type { Account, Snapshot } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleSnapshot } from "./example";
import { readAllJson } from "./data-dirs";

export const SNAPSHOT_PATH = path.join(process.cwd(), "data", "snapshot.json");
export const REQUEST_PATH = path.join(process.cwd(), "data", "refresh-request.json");

/** Union accounts + per-account data across every bridge's snapshot (base dir plus
 *  each extra-login subdirectory). meta comes from the most recently generated one,
 *  and exactly one account is left flagged default. */
function mergeSnapshots(parts: Snapshot[]): Snapshot {
  const merged: Snapshot = { meta: parts[0].meta, accounts: [], data: {} };
  const seen = new Set<string>();
  for (const s of parts) {
    if (new Date(s.meta.generatedAt).getTime() > new Date(merged.meta.generatedAt).getTime()) {
      merged.meta = s.meta;
    }
    for (const a of s.accounts as Account[]) {
      if (seen.has(a.id)) continue; // ignore an accidental duplicate id
      seen.add(a.id);
      merged.accounts.push(a);
    }
    Object.assign(merged.data, s.data);
  }
  // Collapse to a single default: keep the first flagged, else flag the first account.
  let hasDefault = false;
  for (const a of merged.accounts) {
    if (a.isDefault && !hasDefault) hasDefault = true;
    else a.isDefault = false;
  }
  if (!hasDefault && merged.accounts[0]) merged.accounts[0].isDefault = true;
  return merged;
}

function readSnapshotFile(): Snapshot {
  const parts = readAllJson<Snapshot>("snapshot.json").filter(
    (s) => s?.data && Array.isArray(s.accounts),
  );
  if (parts.length === 0) return exampleSnapshot; // none present — fall back to the example dataset
  return mergeSnapshots(parts);
}

export async function getSnapshot(): Promise<Snapshot> {
  if (await isExampleMode()) return exampleSnapshot;
  return readSnapshotFile();
}

export interface RefreshRequest {
  requestedAt: string;
}

export function readRequest(): RefreshRequest | null {
  try {
    return JSON.parse(fs.readFileSync(REQUEST_PATH, "utf8")) as RefreshRequest;
  } catch {
    return null;
  }
}

/** A refresh is pending when a request exists that is newer than the snapshot. */
export function isPending(): boolean {
  const req = readRequest();
  if (!req) return false;
  const snap = readSnapshotFile();
  return new Date(req.requestedAt).getTime() > new Date(snap.meta.generatedAt).getTime();
}
