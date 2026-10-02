// Server-side loader for closed LEAP history (data/leaps-closed.json),
// reconstructed by the data bridge from the broker's option order history. Read
// from every bridge's data dir and scoped to the account being viewed
// (lib/closed-files.ts).
import path from "node:path";
import type { ClosedLeap, ClosedLeapFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleLeapFile } from "./example";
import { readClosedForView } from "./closed-files";

export const LEAPS_CLOSED_PATH = path.join(process.cwd(), "data", "leaps-closed.json");

const EMPTY: ClosedLeapFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedLeaps(): Promise<ClosedLeapFile> {
  if (await isExampleMode()) return exampleLeapFile;
  return readClosedForView<ClosedLeap>("leaps-closed.json", EMPTY);
}
