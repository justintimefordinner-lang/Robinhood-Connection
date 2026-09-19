// Where the Robinhood bridge's folder is, as THIS process sees it. Under Docker
// the release compose file mounts the bridge's state folder into the dashboard
// and points AM_REPORT_BRIDGE_DIR at it; run from a checkout, databridge/ is the
// sibling folder. The app only ever deposits files here (credentials, inbox
// markers, interval settings) — see lib/bridge-files.ts.
import path from "node:path";

export const BRIDGE_DIR = process.env.AM_REPORT_BRIDGE_DIR || path.resolve(process.cwd(), "..", "databridge");
export const BRIDGE_ENV_PATH = path.join(BRIDGE_DIR, ".env");
