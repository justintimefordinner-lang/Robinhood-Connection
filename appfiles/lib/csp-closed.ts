// Server-side loader for closed CSP history (data/csp-closed.json), reconstructed
// by the data bridge from the broker's option order history. Unions across the base
// data/ dir and any extra-login subdirectories so all accounts' round-trips show.
import path from "node:path";
import type { ClosedCSPFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleCspFile } from "./example";
import { readAllJson } from "./data-dirs";

export const CSP_CLOSED_PATH = path.join(process.cwd(), "data", "csp-closed.json");

const EMPTY: ClosedCSPFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedCsps(): Promise<ClosedCSPFile> {
  if (await isExampleMode()) return exampleCspFile;
  const parts = readAllJson<ClosedCSPFile>("csp-closed.json").filter(
    (p) => p?.closed && Array.isArray(p.closed),
  );
  if (parts.length === 0) return EMPTY;
  return { meta: parts[0].meta, closed: parts.flatMap((p) => p.closed) };
}
