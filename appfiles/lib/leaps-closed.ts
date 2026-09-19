// Server-side loader for closed LEAP history (data/leaps-closed.json),
// reconstructed by the data bridge from the broker's option order history. Unions
// across the base data/ dir and any extra-login subdirectories so all accounts show.
import path from "node:path";
import type { ClosedLeapFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleLeapFile } from "./example";
import { readAllJson } from "./data-dirs";

export const LEAPS_CLOSED_PATH = path.join(process.cwd(), "data", "leaps-closed.json");

const EMPTY: ClosedLeapFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedLeaps(): Promise<ClosedLeapFile> {
  if (await isExampleMode()) return exampleLeapFile;
  const parts = readAllJson<ClosedLeapFile>("leaps-closed.json").filter(
    (p) => p?.closed && Array.isArray(p.closed),
  );
  if (parts.length === 0) return EMPTY;
  return { meta: parts[0].meta, closed: parts.flatMap((p) => p.closed) };
}
