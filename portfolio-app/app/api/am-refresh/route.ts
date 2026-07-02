// Force-refreshes the AM report by running am_report.py directly. Unlike the
// portfolio snapshot (which needs Claude Code as a bridge to the Robinhood MCP
// connector — see REFRESH.md), am_report.py already talks to Robinhood on its
// own via robinhood_client.py, so there's nothing stopping the server from
// just running it itself: spawn the script, let it rewrite data/am_report.json
// with a newer meta.asOf, then clean up the request file. /api/am-status keeps
// polling the same way regardless of who/what fulfills the request.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AM_REQUEST_PATH, isAmRefreshPending } from "@/lib/am-report";

export const dynamic = "force-dynamic";

// Assumes am_report.py sits at the project root (alongside package.json) and
// `python3` is on PATH for the user running the Next.js server. If this repo
// uses a virtualenv, point PYTHON_BIN at its interpreter instead, e.g.
// path.join(process.cwd(), "venv", "bin", "python").
const SCRIPT_PATH = path.join(process.cwd(), "am_report.py");
const PYTHON_BIN = process.env.AM_REPORT_PYTHON || "python3";
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

  const child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
    cwd: process.cwd(),
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
