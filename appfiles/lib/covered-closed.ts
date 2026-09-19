// Server-side loader for closed covered-call history (data/covered-closed.json),
// reconstructed by the Schwab bridge from option order history. Unions across the base
// data/ dir and any extra-login subdirectories so all accounts' round-trips show.
import path from "node:path";
import type { ClosedCoveredFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleCoveredFile } from "./example";
import { readAllJson } from "./data-dirs";

export const COVERED_CLOSED_PATH = path.join(process.cwd(), "data", "covered-closed.json");

const EMPTY: ClosedCoveredFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedCovered(): Promise<ClosedCoveredFile> {
  if (await isExampleMode()) return exampleCoveredFile;
  const parts = readAllJson<ClosedCoveredFile>("covered-closed.json").filter(
    (p) => p?.closed && Array.isArray(p.closed),
  );
  if (parts.length === 0) return EMPTY;
  return { meta: parts[0].meta, closed: parts.flatMap((p) => p.closed) };
}
