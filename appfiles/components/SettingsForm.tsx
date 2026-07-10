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
    lockedUntil: string | null;
    consecutiveFailures: number;
  } | null>(null);

  // --- Reconnect button ----------------------------------------------
  const [reconnectStatus, setReconnectStatus] = useState<"idle" | "requesting" | "requested" | "error">("idle");
  const [reconnectError, setReconnectError] = useState("");

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
      setLock({ locked: data.locked, lockedUntil: data.lockedUntil, consecutiveFailures: data.consecutiveFailures });
    } catch {
      setLock(null);
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
    try {
      const res = await fetch("/api/robinhood-reconnect", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Request failed.");
      setReconnectStatus("requested");
      // Give the backend a moment to write a failure/lock state if this attempt
      // gets rejected by the cooldown or fails, then refresh the readout.
      setTimeout(loadLockStatus, 4000);
    } catch (err) {
      setReconnectStatus("error");
      setReconnectError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  return (
    <div className="space-y-5">
      {/* Lockout status banner */}
      {lock?.locked && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Login is paused after {lock.consecutiveFailures} consecutive failure
          {lock.consecutiveFailures === 1 ? "" : "s"} — this protects against repeating the earlier
          rate-limit lockout. It'll allow another attempt automatically at{" "}
          {lock.lockedUntil ? new Date(lock.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}.
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
          Clears the saved Robinhood session and forces a brand-new login. Use this if a login attempt
          was interrupted (e.g. you missed the device-approval push notification) and it doesn&apos;t
          seem to be retrying on its own.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={reconnect}
            disabled={reconnectStatus === "requesting" || !!lock?.locked}
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
    </div>
  );
}
