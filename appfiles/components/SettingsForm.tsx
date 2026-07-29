"use client";

// Settings page content: a small accordion-style menu. Each top-level item
// (e.g. "Refresh intervals", "Robinhood connection") is collapsed by default
// and expands on tap, so the page can grow more settings sections later
// without turning into one long scroll of unrelated controls.
import { useEffect, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shared accordion shell
// ---------------------------------------------------------------------------

function MenuItem({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-muted">{subtitle}</span>}
        </span>
        <span className="shrink-0 text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-border px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refresh intervals (moved in from what used to be the whole page)
// ---------------------------------------------------------------------------

interface Intervals {
  appMinutes: number;
  researchMinutes: number;
  amReportMinutes: number;
  amLadderMinutes: number;
}

const INTERVAL_FIELDS: Array<{ key: keyof Intervals; label: string; hint: string }> = [
  { key: "appMinutes", label: "Portfolio snapshot", hint: "Positions, balances, LEAPs/CSPs — the main dashboard data." },
  { key: "researchMinutes", label: "Research", hint: "Approved-stock screener and signal refresh." },
  { key: "amReportMinutes", label: "Morning Brief", hint: "Full rebuild of the daily brief." },
  { key: "amLadderMinutes", label: "Put ladder", hint: "Lighter intraday premium refresh." },
];

function inputClass() {
  return "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted/60 outline-none ring-emerald-400/40 focus:ring-2";
}

function labelClass() {
  return "mb-1 block text-xs font-medium text-muted";
}

// Renders an ISO timestamp as "3m ago" / "5h ago" / "2d ago" etc. `nowMs` is
// passed in (rather than read fresh via Date.now() inline) so callers can
// force a re-render on a timer and get an updated relative string without
// needing to re-fetch anything from the server.
function formatRelativeTime(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function IntervalsSection({ initialIntervals }: { initialIntervals: Intervals }) {
  const [intervals, setIntervals] = useState<Intervals>(initialIntervals);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intervals),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed.");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  return (
    <form onSubmit={save}>
      <p className="text-xs text-muted">
        In minutes. Applies automatically within a few seconds — no restart needed. Set to 0 to pause
        that refresh entirely (existing data stays as-is until you raise it again).
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {INTERVAL_FIELDS.map(({ key, label, hint }) => (
          <div key={key} className="col-span-2 sm:col-span-1">
            <label className={labelClass()} htmlFor={key}>{label}</label>
            <input
              id={key}
              type="number"
              min={0}
              step={0.5}
              className={inputClass()}
              value={intervals[key]}
              onChange={(e) =>
                setIntervals((prev) => ({ ...prev, [key]: e.target.value === "" ? 0 : Number(e.target.value) }))
              }
            />
            <p className="mt-1 text-[11px] text-muted">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-full bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 active:bg-emerald-500/25 disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : "Save intervals"}
        </button>
        {status === "saved" && <span className="text-xs text-emerald-400">Saved — takes effect within ~5s.</span>}
        {status === "error" && <span className="text-xs text-rose-400">{error}</span>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Robinhood connection
// ---------------------------------------------------------------------------

function RobinhoodSection() {
  // --- Credentials form -----------------------------------------------
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [credStatus, setCredStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
  const [credError, setCredError] = useState("");

  // --- Lockout status ----------------------------------------------------
  const [lock, setLock] = useState<{
    locked: boolean;
    manualRequired: boolean;
    lockedUntil: string | null;
    consecutiveFailures: number;
    lastAttemptAt: string | null;
    lastErrorType: "rate_limited" | "auth_failed" | "unknown" | null;
  } | null>(null);

  // --- Reconnect button ----------------------------------------------
  const [reconnectStatus, setReconnectStatus] = useState<"idle" | "requesting" | "requested" | "error">("idle");
  const [reconnectError, setReconnectError] = useState("");

  // Ticks every 30s so the "last attempt: Xm/h/d ago" text below stays
  // current without re-fetching /api/robinhood-status on a timer just for
  // that — the actual data only changes on load or after a reconnect.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function loadCredentials() {
    try {
      const res = await fetch("/api/robinhood-credentials");
      const data = await res.json();
      setConfigured(!!data.configured);
      setUsername(data.username || "");
      setCredStatus("idle");
    } catch {
      setCredStatus("error");
      setCredError("Couldn't load current status.");
    }
  }

  async function loadLockStatus() {
    try {
      const res = await fetch("/api/robinhood-status");
      const data = await res.json();
      setLock({
        locked: data.locked,
        manualRequired: !!data.manualRequired,
        lockedUntil: data.lockedUntil,
        consecutiveFailures: data.consecutiveFailures,
        lastAttemptAt: data.lastAttemptAt ?? null,
        lastErrorType: data.lastErrorType ?? null,
      });
      return data.lastAttemptAt as string | null;
    } catch {
      setLock(null);
      return null;
    }
  }

  useEffect(() => {
    loadCredentials();
    loadLockStatus();
  }, []);

  async function saveCredentials(e: React.FormEvent) {
    e.preventDefault();
    setCredStatus("saving");
    setCredError("");
    try {
      const res = await fetch("/api/robinhood-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed.");
      setPassword("");
      setConfigured(true);
      setCredStatus("saved");
      setTimeout(() => setCredStatus("idle"), 3000);
    } catch (err) {
      setCredStatus("error");
      setCredError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function reconnect() {
    setReconnectStatus("requesting");
    setReconnectError("");
    const baseline = lock?.lastAttemptAt ?? null;
    try {
      const res = await fetch("/api/robinhood-reconnect", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Request failed.");
      setReconnectStatus("requested");
      // The script can take a while (Robinhood's own challenge/verification
      // flow, per the 429s we've seen, doesn't fail fast) — poll a handful of
      // times rather than checking once, and stop as soon as we see a newer
      // last-attempt timestamp than what was there before this click.
      for (const delayMs of [3000, 6000, 10000, 15000, 20000]) {
        await new Promise((r) => setTimeout(r, delayMs));
        const lastAttemptAt = await loadLockStatus();
        if (lastAttemptAt && lastAttemptAt !== baseline) break;
      }
    } catch (err) {
      setReconnectStatus("error");
      setReconnectError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  return (
    <div className="space-y-5">
      {/* Always-visible: when the last login attempt (success or failure) happened */}
      {lock?.lastAttemptAt && (
        <div className="text-xs text-muted">
          Last login attempt: <span className="text-text">{formatRelativeTime(lock.lastAttemptAt, nowMs)}</span>{" "}
          <span className="text-muted">
            ({new Date(lock.lastAttemptAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })})
          </span>
        </div>
      )}

      {/* Interpreted result of the most recent attempt, if it failed */}
      {lock?.lastErrorType === "rate_limited" && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <strong>Robinhood rejected this login (HTTP 429 — too many requests).</strong> This is
          Robinhood's own rate limit on their servers, not something on our end, and retrying sooner
          is likely to extend it rather than clear it. Best move is to stop attempting for a
          while — hours, not minutes — before trying again.
        </div>
      )}
      {lock?.lastErrorType === "auth_failed" && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <strong>Robinhood rejected the login itself</strong> (invalid credentials or a failed
          verification step) — worth double-checking the username/password saved below.
        </div>
      )}
      {lock?.lastErrorType === "unknown" && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <strong>The last login attempt failed</strong> for a reason that isn't one of the
          recognized cases (rate limit or bad credentials) — worth checking the pm2 logs for the
          full detail.
        </div>
      )}

      {/* Lockout status banner */}
      {lock?.manualRequired && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Automatic login retries are paused after {lock.consecutiveFailures} consecutive failures —
          this won't retry on its own anymore. Tap <strong>Reconnect Robinhood</strong> below whenever
          you're ready to try again; manual attempts always go through immediately.
        </div>
      )}
      {lock?.locked && !lock.manualRequired && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Automatic retries are paused after {lock.consecutiveFailures} consecutive failure
          {lock.consecutiveFailures === 1 ? "" : "s"} — this protects against repeating the earlier
          rate-limit lockout. It'll allow another automatic attempt at{" "}
          {lock.lockedUntil
            ? new Date(lock.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })
            : "—"}
          {" "}— or tap <strong>Reconnect Robinhood</strong> below to try again right now.
        </div>
      )}

      {/* Credentials */}
      <form onSubmit={saveCredentials}>
        <p className="text-xs text-muted">
          Saved only to <code className="text-[10px]">databridge/.env</code> (gitignored, file permissions
          locked to owner-only) — never committed, never sent anywhere else.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <label className={labelClass()} htmlFor="rh-username">Username / email</label>
            <input
              id="rh-username"
              type="text"
              autoComplete="username"
              className={inputClass()}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className={labelClass()} htmlFor="rh-password">Password</label>
            <input
              id="rh-password"
              type="password"
              autoComplete="current-password"
              className={inputClass()}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={configured ? "•••••••• (saved — enter to replace)" : "Enter password"}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={credStatus === "saving"}
            className="rounded-full bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 active:bg-emerald-500/25 disabled:opacity-60"
          >
            {credStatus === "saving" ? "Saving…" : "Save credentials"}
          </button>
          {credStatus === "saved" && <span className="text-xs text-emerald-400">Saved.</span>}
          {credStatus === "error" && <span className="text-xs text-rose-400">{credError}</span>}
          {configured === true && credStatus === "idle" && (
            <span className="text-xs text-muted">Currently configured for {username}.</span>
          )}
        </div>
      </form>

      <div className="border-t border-border pt-4">
        <p className="text-xs text-muted">
          Makes exactly one login attempt right now. If your existing session is still valid this
          succeeds instantly with no prompt; if not, Robinhood may send a device-approval push to
          your phone as part of this same attempt — have it ready before tapping. This does not
          retry on its own, so avoid pressing it repeatedly in a row if it fails; that's what can
          extend a Robinhood-side rate limit rather than clear it.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={reconnect}
            disabled={reconnectStatus === "requesting"}
            className="rounded-full bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 active:bg-emerald-500/25 disabled:opacity-60"
          >
            {reconnectStatus === "requesting" ? "Requesting…" : "Reconnect Robinhood"}
          </button>
          {reconnectStatus === "requested" && (
            <span className="text-xs text-emerald-400">Requested — check your phone for a new approval prompt.</span>
          )}
          {reconnectStatus === "error" && <span className="text-xs text-rose-400">{reconnectError}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App update (git pull + pm2 restart)
// ---------------------------------------------------------------------------

function GitUpdateSection() {
  const [status, setStatus] = useState<"idle" | "requesting" | "restarting" | "done" | "error">("idle");
  const [log, setLog] = useState("");
  const [error, setError] = useState("");

  async function pollLog(): Promise<string> {
    const res = await fetch("/api/git-update");
    const data = await res.json();
    return (data.log as string) ?? "";
  }

  async function triggerUpdate() {
    setStatus("requesting");
    setError("");
    setLog("");
    try {
      const res = await fetch("/api/git-update", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Request failed.");
      setStatus("restarting");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Request failed.");
      return;
    }

    // From here on, `appfiles` itself may get killed and replaced by pm2
    // mid-poll - a failed fetch during that window just means "still
    // restarting," not a real error, so keep retrying rather than bailing
    // on the first connection refusal. npm install + a Next.js build on a
    // Pi can take several minutes, so give this up to ~10 minutes total,
    // not just long enough for a plain restart.
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const text = await pollLog();
        setLog(text);
        if (/finished, exit code|Done\.$/.test(text.trim())) {
          setStatus(/finished, exit code 0|Done\.$/.test(text.trim()) ? "done" : "error");
          if (!/Done\.$/.test(text.trim())) {
            setError("git pull or pm2 restart failed - see log below.");
          }
          return;
        }
      } catch {
        // Still restarting (or briefly unreachable) - keep polling.
      }
    }
    setStatus("error");
    setError("Timed out waiting for the update to finish (10 min) - check the log below or pm2 logs directly.");
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Runs <code className="text-[10px]">git pull</code>, then <code className="text-[10px]">npm install</code>{" "}
        and <code className="text-[10px]">npm run build</code> (a plain restart alone would just re-serve the
        old build), then restarts every pm2 process including this app itself. Can take a few minutes on a
        Pi - the page may stop responding briefly while <code className="text-[10px]">appfiles</code> restarts
        at the end; that&apos;s expected, not a failure.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={triggerUpdate}
          disabled={status === "requesting" || status === "restarting"}
          className="rounded-full bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 active:bg-emerald-500/25 disabled:opacity-60"
        >
          {status === "requesting" || status === "restarting" ? "Updating…" : "Update from GitHub"}
        </button>
        {status === "done" && <span className="text-xs text-emerald-400">Updated and restarted.</span>}
        {status === "error" && <span className="text-xs text-rose-400">{error}</span>}
      </div>

      {log && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-surface-2 p-2 text-[11px] text-muted">
          {log}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level menu
// ---------------------------------------------------------------------------

export function SettingsForm({ initialIntervals }: { initialIntervals: Intervals }) {
  return (
    <div className="space-y-3">
      <MenuItem title="Refresh intervals" subtitle="How often each data source updates">
        <IntervalsSection initialIntervals={initialIntervals} />
      </MenuItem>
      <MenuItem title="Robinhood connection" subtitle="Credentials, login status, and reconnect">
        <RobinhoodSection />
      </MenuItem>
      <MenuItem title="App update" subtitle="Pull latest code from GitHub and restart">
        <GitUpdateSection />
      </MenuItem>
    </div>
  );
}
