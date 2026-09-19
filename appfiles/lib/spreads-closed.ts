// Server-side loader for closed vertical-spread history (data/spreads-closed.json),
// reconstructed by the Schwab bridge from option order history. Unions across the base
// data/ dir and any extra-login subdirectories so all accounts' round-trips show.
import path from "node:path";
import type { ClosedSpreadFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleSpreadFile } from "./example";
import { readAllJson } from "./data-dirs";

export const SPREADS_CLOSED_PATH = path.join(process.cwd(), "data", "spreads-closed.json");

const EMPTY: ClosedSpreadFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedSpreads(): Promise<ClosedSpreadFile> {
  if (await isExampleMode()) return exampleSpreadFile;
  const parts = readAllJson<ClosedSpreadFile>("spreads-closed.json").filter(
    (p) => p?.closed && Array.isArray(p.closed),
  );
  if (parts.length === 0) return EMPTY;
  return { meta: parts[0].meta, closed: parts.flatMap((p) => p.closed) };
}
