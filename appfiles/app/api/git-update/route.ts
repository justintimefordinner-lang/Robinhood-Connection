// Backs the Settings page's "Update from GitHub" button: runs `git pull` in
// the repo root, rebuilds the Next.js app (npm install + npm run build,
// since `pm2 restart` alone just re-serves whatever was already built into
// .next/ - it does NOT pick up new appfiles/ source on its own), then
// restarts the pm2 processes so the new code actually takes effect. One tap
// instead of SSHing in for `git pull && npm install && npm run build && pm2
// restart`.
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
// AM_REPORT_BRIDGE_DIR in the robinhood-reconnect route. APPFILES_DIR is
// just process.cwd() itself, named explicitly so the build-step commands
// below read clearly regardless of where this route happens to be running.
const REPO_DIR = process.env.APP_REPO_DIR || path.resolve(process.cwd(), "..");
const APPFILES_DIR = process.cwd();
const LOG_PATH = path.join(process.cwd(), "data", "git-update.log");

let pending = false;

export async function POST() {
  if (pending) {
    return Response.json({ ok: true, alreadyRunning: true });
  }
  pending = true;

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const log = fs.openSync(LOG_PATH, "a");
  fs.writeSync(log, `\n--- git update requested ${new Date().toISOString()} ---\n`);

  // `set -e` means a failure at ANY step (git pull conflict, npm install
  // error, a build that doesn't compile, etc.) stops the script before the
  // next step runs - in particular, before pm2 restart, so a broken build
  // never gets served: every process just keeps running the last good build
  // until this succeeds cleanly end to end.
  const script = [
    "set -e",
    "echo '$ git pull'",
    "git pull",
    `cd "${APPFILES_DIR}"`,
    "echo '$ npm install'",
    "npm install",
    "echo '$ npm run build'",
    "npm run build",
    "echo 'Build succeeded - restarting all pm2 processes'",
    // `all` rather than an explicit name list: the list would go stale every
    // time a process is added (it had already missed MinuteTracker and
    // banker, which would have kept running pre-update code). Note this also
    // STARTS anything currently stopped - so a process left stopped on
    // purpose will come back up after an update.
    "pm2 restart all",
    // Persist the resulting process list so a reboot resurrects this state
    // rather than whatever was saved last.
    "pm2 save",
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
// new instance is back up). Tail is longer than before (npm install/build
// output is a lot chattier than a plain git pull + pm2 restart was).
export async function GET() {
  try {
    const raw = fs.readFileSync(LOG_PATH, "utf8");
    const lines = raw.trim().split("\n");
    return Response.json({ ok: true, log: lines.slice(-120).join("\n") });
  } catch {
    return Response.json({ ok: true, log: "" });
  }
}
