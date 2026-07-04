// Force-refreshes the AM report by running am_report.py directly. Unlike the
// portfolio snapshot (which needs Claude Code as a bridge to the Robinhood MCP
// connector — see REFRESH.md), am_report.py already talks to Robinhood on its
// own via robinhood_client.py, so there's nothing stopping the server from
// just running it itself: spawn the script, let it rewrite data/am_report.json
// with a newer meta.asOf, then clean up the request file. /api/am-status keeps
// polling the same way regardless of who/what fulfills the request.
//
// am_report.py lives in the sibling `robinhood-bridge` project (its own repo,
// its own .venv, its own .env with APP_DATA_DIR pointing back at this app's
// data/ folder) — NOT inside this Next.js project. research_sync.py and
// robinhood_client.py both call load_dotenv() at import time, which searches
// the current working directory for .env, so we must spawn with cwd set to
// robinhood-bridge/, or APP_DATA_DIR won't be found and the script will exit.
// This runs as a one-off alongside robinhood-bridge.service's own 30-min
// auto_push.py loop (which calls the same am_report.main() on a timer) —
// harmless overlap, just an extra independent Robinhood API round trip.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AM_REQUEST_PATH, isAmRefreshPending } from "@/lib/am-report";

export const dynamic = "force-dynamic";

// portfolio-app and robinhood-bridge are sibling folders under ~/JerStock.
// Override BRIDGE_DIR/AM_REPORT_PYTHON via env vars if your layout differs.
const BRIDGE_DIR = process.env.AM_REPORT_BRIDGE_DIR || path.resolve(process.cwd(), "..", "robinhood-bridge");
const SCRIPT_PATH = path.join(BRIDGE_DIR, "am_report.py");
const PYTHON_BIN = process.env.AM_REPORT_PYTHON || path.join(BRIDGE_DIR, ".venv", "bin", "python");
const LOG_PATH = path.join(process.cwd(), "data", "am-refresh.log");

export async function POST() {
  if (isAmRefreshPending()) {
    // Already running — don't spawn a second one.
    return Response.json({ ok: true, alreadyRunning: true });
  }

  fs.mkdirSync(path.dirname(AM_REQUEST_PATH), { recursive: true });
  fs.writeFileSync(AM_REQUEST_PATH, JSON.stringify({ requestedAt: new Date().toISOString() }));

  const log = fs.openSync(LOG_PATH, "a");
  fs.writeSync(log, `\n--- am_report refresh requested ${new Date().toISOString()} ---\n`);

  const child = spawn(PYTHON_BIN, [SCRIPT_PATH, "--force"], {
    cwd: BRIDGE_DIR,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  child.on("exit", (code) => {
    fs.writeSync(log, `--- am_report exited with code ${code} ---\n`);
    fs.closeSync(log);
    try {
      fs.unlinkSync(AM_REQUEST_PATH);
    } catch {
      // already gone
    }
  });
  child.on("error", (err) => {
    fs.writeSync(log, `--- failed to spawn am_report.py: ${String(err)} ---\n`);
    try {
      fs.unlinkSync(AM_REQUEST_PATH);
    } catch {
      // already gone
    }
  });

  return Response.json({ ok: true });
}
