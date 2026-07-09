// Backs the Settings page's "Reconnect Robinhood" button. Spawns
// reconnect_robinhood.py, which deletes the stale ~/.tokens/robinhood.pickle
// session file and forces a brand-new rh.login() call — that's what actually
// re-triggers Robinhood's device-approval push notification, rather than
// silently retrying whatever half-finished session was left behind.
//
// Same sibling-folder spawn pattern as /api/am-refresh: the script lives in
// databridge/ (its own repo/venv/.env), so we spawn with cwd set there.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const BRIDGE_DIR = process.env.AM_REPORT_BRIDGE_DIR || path.resolve(process.cwd(), "..", "databridge");
const SCRIPT_PATH = path.join(BRIDGE_DIR, "reconnect_robinhood.py");
const PYTHON_BIN = process.env.AM_REPORT_PYTHON || path.join(BRIDGE_DIR, ".venv", "bin", "python");
const LOG_PATH = path.join(process.cwd(), "data", "robinhood-reconnect.log");

let pending = false;

export async function POST() {
  if (pending) {
    return Response.json({ ok: true, alreadyRunning: true });
  }
  pending = true;

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const log = fs.openSync(LOG_PATH, "a");
  fs.writeSync(log, `\n--- reconnect requested ${new Date().toISOString()} ---\n`);

  const child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
    cwd: BRIDGE_DIR,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  child.on("exit", (code) => {
    fs.writeSync(log, `--- reconnect_robinhood.py exited with code ${code} ---\n`);
    fs.closeSync(log);
    pending = false;
  });
  child.on("error", (err) => {
    fs.writeSync(log, `--- failed to spawn reconnect_robinhood.py: ${String(err)} ---\n`);
    pending = false;
  });

  return Response.json({ ok: true });
}
