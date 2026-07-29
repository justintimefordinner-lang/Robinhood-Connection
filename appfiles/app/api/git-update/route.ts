// Backs the Settings page's "Update from GitHub" button: runs `git pull` in
// the repo root, then restarts the pm2 processes so the new code actually
// takes effect - one tap instead of SSHing in for `git pull && pm2 restart`.
//
// Same detached-spawn pattern as /api/robinhood-reconnect: the HTTP response
// returns immediately once the background script is launched, since the
// restart step will eventually kill and replace the very Next.js process
// serving this request. `detached: true` + `child.unref()` puts the child in
// its own process group so it isn't taken down along with this process when
// pm2 restarts "appfiles" partway through the script.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// process.cwd() for the Next app is .../JerStock/appfiles, so the repo root
// (where .git lives) is one level up - same resolution style as
// AM_REPORT_BRIDGE_DIR in the robinhood-reconnect route.
const REPO_DIR = process.env.APP_REPO_DIR || path.resolve(process.cwd(), "..");
const LOG_PATH = path.join(process.cwd(), "data", "git-update.log");

// Restart these specific pm2 processes (matches ecosystem.config.js) rather
// than `pm2 restart all` - keeps the list explicit, so some unrelated pm2
// process added later on the Pi wouldn't get bounced by this button too.
const PM2_PROCESSES = ["appfiles", "databridge", "databridge-history", "databridge-earnings"];

let pending = false;

export async function POST() {
  if (pending) {
    return Response.json({ ok: true, alreadyRunning: true });
  }
  pending = true;

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const log = fs.openSync(LOG_PATH, "a");
  fs.writeSync(log, `\n--- git update requested ${new Date().toISOString()} ---\n`);

  // `set -e` means a failed `git pull` (merge conflict, no network, etc.)
  // stops the script before touching pm2 at all - no point restarting every
  // process into the exact same code that was already running.
  const script = [
    "set -e",
    "echo '$ git pull'",
    "git pull",
    "echo 'git pull succeeded - restarting pm2 processes'",
    `pm2 restart ${PM2_PROCESSES.join(" ")}`,
    "echo 'Done.'",
  ].join("\n");

  const child = spawn("bash", ["-c", script], {
    cwd: REPO_DIR,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  child.on("exit", (code) => {
    try {
      fs.writeSync(log, `--- git update finished, exit code ${code} ---\n`);
      fs.closeSync(log);
    } catch {
      // log fd may already be gone if this fires after a restart tore
      // things down; nothing to do about it.
    }
    pending = false;
  });
  child.on("error", (err) => {
    fs.writeSync(log, `--- failed to spawn git update: ${String(err)} ---\n`);
    pending = false;
  });

  return Response.json({ ok: true });
}

// Lets the Settings page poll for the tail of the log after triggering an
// update, including across the brief window where this very server process
// is being restarted (the fetch will just fail/retry client-side until the
// new instance is back up).
export async function GET() {
  try {
    const raw = fs.readFileSync(LOG_PATH, "utf8");
    const lines = raw.trim().split("\n");
    return Response.json({ ok: true, log: lines.slice(-40).join("\n") });
  } catch {
    return Response.json({ ok: true, log: "" });
  }
}
