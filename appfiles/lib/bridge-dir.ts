// appfiles and databridge are sibling folders under ~/Robinhood-Connection. Both the
// am-refresh route and the settings route need to find databridge/ (one to
// spawn a script in it, the other to read/write its .env) — this centralizes
// that resolution so there's one place to fix if your layout differs.
// Override via AM_REPORT_BRIDGE_DIR (same var app/api/am-refresh/route.ts
// already documents) if databridge isn't a sibling folder on your setup.
import path from "node:path";

export const BRIDGE_DIR = process.env.AM_REPORT_BRIDGE_DIR || path.resolve(process.cwd(), "..", "databridge");
export const BRIDGE_ENV_PATH = path.join(BRIDGE_DIR, ".env");
