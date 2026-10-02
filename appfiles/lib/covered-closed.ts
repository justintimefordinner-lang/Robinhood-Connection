// Server-side loader for closed covered-call history (data/covered-closed.json),
// reconstructed by the Schwab bridge from option order history. Read from every
// bridge's data dir and scoped to the account being viewed (lib/closed-files.ts).
import path from "node:path";
import type { ClosedCoveredCall, ClosedCoveredFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleCoveredFile } from "./example";
import { readClosedForView } from "./closed-files";

export const COVERED_CLOSED_PATH = path.join(process.cwd(), "data", "covered-closed.json");

const EMPTY: ClosedCoveredFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedCovered(): Promise<ClosedCoveredFile> {
  if (await isExampleMode()) return exampleCoveredFile;
  return readClosedForView<ClosedCoveredCall>("covered-closed.json", EMPTY);
}
