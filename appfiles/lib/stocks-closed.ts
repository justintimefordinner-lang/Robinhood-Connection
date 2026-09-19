// Server-side loader for closed stock history (data/stocks-closed.json),
// reconstructed by the Schwab bridge from equity order history. Unions across the
// base data/ dir and any extra-login subdirectories so all accounts' round-trips show.
import path from "node:path";
import type { ClosedStockFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleStockFile } from "./example";
import { readAllJson } from "./data-dirs";

export const STOCKS_CLOSED_PATH = path.join(process.cwd(), "data", "stocks-closed.json");

const EMPTY: ClosedStockFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedStocks(): Promise<ClosedStockFile> {
  if (await isExampleMode()) return exampleStockFile;
  const parts = readAllJson<ClosedStockFile>("stocks-closed.json").filter(
    (p) => p?.closed && Array.isArray(p.closed),
  );
  if (parts.length === 0) return EMPTY;
  return { meta: parts[0].meta, closed: parts.flatMap((p) => p.closed) };
}
