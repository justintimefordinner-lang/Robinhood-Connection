// Server-side loader for closed CSP history (data/csp-closed.json), reconstructed
// by the data bridge from the broker's option order history. Read from every
// bridge's data dir and scoped to the account being viewed (lib/closed-files.ts).
import path from "node:path";
import type { ClosedCSP, ClosedCSPFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleCspFile } from "./example";
import { readClosedForView } from "./closed-files";

export const CSP_CLOSED_PATH = path.join(process.cwd(), "data", "csp-closed.json");

const EMPTY: ClosedCSPFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedCsps(): Promise<ClosedCSPFile> {
  if (await isExampleMode()) return exampleCspFile;
  return readClosedForView<ClosedCSP>("csp-closed.json", EMPTY);
}
