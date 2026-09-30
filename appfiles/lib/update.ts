// In-app updates. Two halves:
//
//   * NOTICING. The image carries the commit it was built from (BUILD_SHA, set by
//     the publish workflow). Every five hours the app asks GitHub for the most recent
//     successful publish on main and compares. Anonymous, read-only, one request.
//
//   * APPLYING. A container cannot replace itself, so the dashboard only drops a
//     marker file into its own data/ folder. The `updater` service in the release
//     compose file (a Docker CLI with the host's Docker socket) watches for it and
//     runs `docker compose pull && up -d` for this project, then reports back
//     through update-status.json. Same write-only, poll-a-status-file contract as
//     everything else the dashboard asks a container to do.
//
// Both halves are off on a demo host and on a checkout with no BUILD_SHA.
import fs from "node:fs";
import path from "node:path";

export const REPO = "justintimefordinner-lang/Robinhood-Connection";
export const BUILD_SHA = (process.env.BUILD_SHA || "").trim();
const CHECK_TTL_MS = 5 * 60 * 60 * 1000; // ask GitHub at most every 5 hours

const DATA_DIR = path.join(process.cwd(), "data");
const REQUEST_PATH = path.join(DATA_DIR, "update-request");
const STATUS_PATH = path.join(DATA_DIR, "update-status.json");

export interface UpdateCheck {
  enabled: boolean; // false on a demo or a checkout: nothing to compare against
  current: string; // short sha of the running build
  latest: string | null; // short sha of the newest published build
  available: boolean;
  publishedAt: string | null;
  changes: string[]; // first line of each commit since the running build, newest first
  checkedAt: string | null;
  error: string | null;
}

let cache: { at: number; value: UpdateCheck } | null = null;

const gh = (p: string) =>
  fetch(`https://api.github.com/repos/${REPO}${p}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "portfolio-dashboard-update-check" },
    cache: "no-store",
  });

export async function checkForUpdate(force = false): Promise<UpdateCheck> {
  const base: UpdateCheck = { enabled: !!BUILD_SHA, current: BUILD_SHA.slice(0, 7), latest: null, available: false, publishedAt: null, changes: [], checkedAt: null, error: null };
  if (!BUILD_SHA) return base;
  if (!force && cache && Date.now() - cache.at < CHECK_TTL_MS) return cache.value;
  const out = { ...base, checkedAt: new Date().toISOString() };
  try {
    // The newest build that actually published, not merely the newest commit —
    // the image lands a few minutes after the push.
    const runs = await gh("/actions/workflows/publish.yml/runs?branch=main&status=success&per_page=1");
    if (!runs.ok) throw new Error(`GitHub answered ${runs.status}`);
    const run = ((await runs.json()) as { workflow_runs?: { head_sha: string; updated_at: string }[] }).workflow_runs?.[0];
    if (!run) throw new Error("no published build found");
    out.latest = run.head_sha.slice(0, 7);
    out.publishedAt = run.updated_at;
    out.available = run.head_sha !== BUILD_SHA;
    if (out.available) {
      const cmp = await gh(`/compare/${BUILD_SHA}...${run.head_sha}`);
      if (cmp.ok) {
        const commits = ((await cmp.json()) as { commits?: { commit: { message: string } }[] }).commits ?? [];
        out.changes = commits
          .map((c) => c.commit.message.split("\n")[0].trim())
          .filter((m) => m && !/^merge /i.test(m))
          .reverse();
      }
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : "check failed";
  }
  cache = { at: Date.now(), value: out };
  return out;
}

/** Drop the "please update" marker. Write-only. */
export function requestUpdate(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REQUEST_PATH, new Date().toISOString() + "\n");
  try {
    fs.unlinkSync(STATUS_PATH); // a stale "done" from last time would read as this one finishing instantly
  } catch {
    // none on file
  }
}

export interface UpdateStatus {
  status: "idle" | "requested" | "running" | "done" | "error";
  message: string | null;
  updatedAt: string | null;
}

/** What the updater reported, plus whether our marker is still waiting to be picked up. */
export function readUpdateStatus(): UpdateStatus {
  let s: UpdateStatus = { status: "idle", message: null, updatedAt: null };
  try {
    s = { ...s, ...(JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) as Partial<UpdateStatus>) };
  } catch {
    // nothing reported yet
  }
  if (s.status === "idle" && fs.existsSync(REQUEST_PATH)) s = { ...s, status: "requested" };
  return s;
}
