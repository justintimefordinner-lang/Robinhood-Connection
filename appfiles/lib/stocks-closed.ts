// Server-side loader for closed stock history (data/stocks-closed.json),
// reconstructed by the Schwab bridge from equity order history. Read from every
// bridge's data dir and scoped to the account being viewed (lib/closed-files.ts).
import path from "node:path";
import type { ClosedStock, ClosedStockFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleStockFile } from "./example";
import { readClosedForView } from "./closed-files";

export const STOCKS_CLOSED_PATH = path.join(process.cwd(), "data", "stocks-closed.json");

const EMPTY: ClosedStockFile = { meta: { generatedAt: "", source: "" }, closed: [] };

export async function getClosedStocks(): Promise<ClosedStockFile> {
  if (await isExampleMode()) return exampleStockFile;
  return readClosedForView<ClosedStock>("stocks-closed.json", EMPTY);
}
