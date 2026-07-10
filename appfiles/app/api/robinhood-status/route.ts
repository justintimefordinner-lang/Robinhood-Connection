// Reads the same ~/.tokens/robinhood_login_state.json file that
// databridge/login_guard.py writes to. No need to shell out to Python for a
// plain JSON read — this file is the single shared source of truth for the
// cooldown state across every pm2 process (databridge, databridge-earnings,
// databridge-history, MinuteTracker) and any one-off script.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const dynamic = "force-dynamic";

const STATE_PATH = path.join(os.homedir(), ".tokens", "robinhood_login_state.json");

interface GuardState {
  consecutive_failures?: number;
  locked_until?: string | null;
  last_attempt_at?: string | null;
}

export async function GET() {
  let state: GuardState = {};
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    state = JSON.parse(raw);
  } catch {
    // File doesn't exist yet (no login attempts recorded) — treat as clean state.
  }

  const lockedUntil = state.locked_until ? new Date(state.locked_until) : null;
  const locked = !!lockedUntil && lockedUntil.getTime() > Date.now();

  return Response.json({
    locked,
    lockedUntil: locked ? lockedUntil!.toISOString() : null,
    consecutiveFailures: state.consecutive_failures ?? 0,
    lastAttemptAt: state.last_attempt_at ?? null,
  });
}
