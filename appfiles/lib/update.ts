// In-app updates. Two halves:
//
//   Only the dashboard's own repo is watched. The bridge publishes from its
//   own repo, so a bridge-only release does not light the dot; "Update now" still
//   pulls both images.
//
//   * NOTICING. The image carries the commit it was built from (BUILD_SHA, set by
//     the publish workflow). Every five hours the app asks the registry (GHCR) what
//     build the "latest" image carries and compares. Anonymous, read-only, and not
//     subject to GitHub's 60-requests-an-hour API limit, which a home address shared
//     by several machines used to run into. GitHub's API is only asked for the list
//     of changes, once, when something new has been published.
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

// A failed check is remembered for ten minutes, not five hours, so the card
// recovers on its own once GitHub answers again.
const FAIL_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; ttl: number; value: UpdateCheck } | null = null;

const gh = (p: string) =>
  fetch(`https://api.github.com/repos/${REPO}${p}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "portfolio-dashboard-update-check" },
    cache: "no-store",
  });

/** GitHub allows 60 anonymous requests an hour per address; say when it frees up instead of just "403". */
function explain(r: Response): string {
  if ((r.status === 403 || r.status === 429) && r.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(r.headers.get("x-ratelimit-reset"));
    const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    return `GitHub's hourly limit for this address is used up${at ? ` until ${at}` : ""}`;
  }
  return `GitHub answered ${r.status}`;
}

// The published image, asked directly. The registry has no 60-an-hour limit, and
// the image carries the commit it was built from (ENV BUILD_SHA, set by the
// publish workflow), so four small requests say whether "latest" is this build:
// token → the latest tag's index → one platform's manifest → its config blob.
const REGISTRY = "https://ghcr.io";
const IMAGE = "justintimefordinner-lang/portfolio-dashboard-robinhood";
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

async function latestPublished(): Promise<{ sha: string; createdAt: string | null }> {
  const tokenRes = await fetch(`${REGISTRY}/token?scope=repository:${IMAGE}:pull`, { cache: "no-store" });
  if (!tokenRes.ok) throw new Error(`registry answered ${tokenRes.status}`);
  const token = ((await tokenRes.json()) as { token?: string }).token;
  if (!token) throw new Error("registry gave no token");
  const get = async (p: string) => {
    const r = await fetch(`${REGISTRY}/v2/${IMAGE}/${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT }, cache: "no-store" });
    if (!r.ok) throw new Error(`registry answered ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  };
  let manifest = await get("manifests/latest");
  const list = manifest.manifests as { digest: string; platform?: { os?: string; architecture?: string } }[] | undefined;
  if (Array.isArray(list) && list.length) {
    const pick = list.find((m) => m.platform?.architecture === "arm64" && m.platform?.os === "linux") ?? list.find((m) => m.platform?.os !== "unknown") ?? list[0];
    manifest = await get(`manifests/${pick.digest}`);
  }
  const configDigest = (manifest.config as { digest?: string } | undefined)?.digest;
  if (!configDigest) throw new Error("image has no config");
  const cfg = await get(`blobs/${configDigest}`);
  const env = ((cfg.config as { Env?: string[] } | undefined)?.Env ?? []).find((e) => e.startsWith("BUILD_SHA="));
  const sha = env ? env.slice("BUILD_SHA=".length).trim() : "";
  if (!sha) throw new Error("published image carries no build id");
  return { sha, createdAt: typeof cfg.created === "string" ? cfg.created : null };
}

export async function checkForUpdate(force = false): Promise<UpdateCheck> {
  const base: UpdateCheck = { enabled: !!BUILD_SHA, current: BUILD_SHA.slice(0, 7), latest: null, available: false, publishedAt: null, changes: [], checkedAt: null, error: null };
  if (!BUILD_SHA) return base;
  if (!force && cache && Date.now() - cache.at < cache.ttl) return cache.value;
  const out = { ...base, checkedAt: new Date().toISOString() };
  try {
    const latest = await latestPublished();
    out.latest = latest.sha.slice(0, 7);
    out.publishedAt = latest.createdAt;
    out.available = latest.sha !== BUILD_SHA;
    if (out.available) {
      // The list of what changed is a nicety from GitHub's API: one request, only
      // when there is something new, and skipped without complaint when it fails.
      try {
        const cmp = await gh(`/compare/${BUILD_SHA}...${latest.sha}`);
        if (cmp.ok) {
          const commits = ((await cmp.json()) as { commits?: { commit: { message: string } }[] }).commits ?? [];
          out.changes = commits
            .map((c) => c.commit.message.split("\n")[0].trim())
            .filter((m) => m && !/^merge /i.test(m))
            .reverse();
        } else if (!explain(cmp).startsWith("GitHub answered")) {
          out.changes = ["(change list unavailable: " + explain(cmp) + ")"];
        }
      } catch {
        // offline for the nicety only
      }
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : "check failed";
    // Keep what the last good check found: a build that was available an hour
    // ago is still available, and the button stays usable.
    const prev = cache?.value;
    if (prev?.latest) Object.assign(out, { latest: prev.latest, available: prev.available, publishedAt: prev.publishedAt, changes: prev.changes });
  }
  cache = { at: Date.now(), ttl: out.error ? FAIL_TTL_MS : CHECK_TTL_MS, value: out };
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
