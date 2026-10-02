// Server-side loader for closed vertical-spread history (data/spreads-closed.json),
// reconstructed by the Schwab bridge from option order history. Read from every
// bridge's data dir and scoped to the account being viewed (lib/closed-files.ts).
import path from "node:path";
import type { ClosedSpread, ClosedSpreadFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleSpreadFile } from "./example";
import { readClosedForView } from "./closed-files";

export const SPREADS_CLOSED_PATH = path.join(process.cwd(), "data", "spreads-closed.json");

const EMPTY: ClosedSpreadFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedSpreads(): Promise<ClosedSpreadFile> {
  if (await isExampleMode()) return exampleSpreadFile;
  return readClosedForView<ClosedSpread>("spreads-closed.json", EMPTY);
}
