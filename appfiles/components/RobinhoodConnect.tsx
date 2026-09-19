"use client";

// Robinhood connection: save the sign-in, see the login status, and ask for a
// reconnect — entirely from the dashboard.
//
// Security model (see lib/bridge-files.ts + the bridge's reauth.py): this
// component only ever POSTs data INTO the bridge (the sign-in, a "reconnect"
// request) and reads a sanitized status back from the app's OWN data/ folder.
// It never reads the bridge's secret files. The password is held only
// transiently in this form and cleared right after saving.
//
// Robinhood rate-limits failed logins hard, so the bridge stops retrying on its
// own after a failure. Reconnect is the one deliberate attempt that gets past
// that lock, which is why the status below spells out what went wrong first.
import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE } from "@/lib/demo";

interface Status {
  configured: boolean;
  username: string | null;
  hasTotp: boolean;
  hasSession: boolean;
  authStatus: "needs_setup" | "needs_login" | "connecting" | "connected" | "error";
  manualRequired: boolean;
  lockedUntil: string | null;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
  lastErrorType: "rate_limited" | "auth_failed" | "unknown" | null;
  error: string | null;
  updatedAt: string | null;
}

function inputClass() {
  return "w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted/60 outline-none ring-emerald-400/40 focus:ring-2";
}
function labelClass() {
  return "mb-1 block text-xs font-medium text-muted";
}
function pillButton() {
  return "rounded-full bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 active:bg-emerald-500/25 disabled:opacity-60";
}

function relativeTime(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || "Request failed.");
  return data;
}

export function RobinhoodConnect({ bridge = "primary" }: { bridge?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "setup" | "reconnect">(null);
  const [msg, setMsg] = useState<null | { kind: "ok" | "err"; text: string }>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/robinhood/status?bridge=${encodeURIComponent(bridge)}`, { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      // status file may not exist yet on a brand-new install — leave as loading
    }
    setNow(Date.now());
  }, [bridge]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function saveSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy("setup");
    setMsg(null);
    try {
      await postJson("/api/robinhood/setup", { bridge, username, password, totpSecret });
      setPassword(""); // don't keep the secrets around after they've been deposited
      setTotpSecret("");
      await postJson("/api/robinhood/reconnect", { bridge });
      setEditing(false);
      setMsg({ kind: "ok", text: "Saved. Signing in to Robinhood — approve the prompt on your phone if one appears." });
      await refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setBusy(null);
    }
  }

  async function reconnect() {
    setBusy("reconnect");
    setMsg(null);
    try {
      await postJson("/api/robinhood/reconnect", { bridge });
      setMsg({ kind: "ok", text: "Requested — check your phone for a new approval prompt." });
      await refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Failed." });
    } finally {
      setBusy(null);
    }
  }

  // A public demo has no bridge to sign in to, and a sign-in form on a public page
  // only invites someone to type a real password into it.
  if (DEMO_MODE) {
    return (
      <p className="text-xs text-muted">
        This is the demo, running on sample data. On your own install this is where you enter your Robinhood
        sign-in, see the login status, and reconnect when a session expires. Your sign-in stays on your machine.
      </p>
    );
  }

  if (!status) {
    return <p className="text-xs text-muted">Checking connection…</p>;
  }

  const s = status.authStatus;
  const needsSetup = !status.configured || s === "needs_setup";
  const connecting = s === "connecting";
  const connected = s === "connected";
  const showForm = needsSetup || editing;
  const timeLocked = !!status.lockedUntil && new Date(status.lockedUntil).getTime() > now;

  return (
    <div className="space-y-4">
      {/* status line */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={
            "inline-block h-2 w-2 shrink-0 rounded-full " +
            (connected ? "bg-emerald-400" : connecting ? "bg-amber-400" : needsSetup ? "bg-muted" : "bg-rose-400")
          }
        />
        <span className="text-muted">
          {connected
            ? "Connected to Robinhood."
            : connecting
              ? "Signing in… approve the prompt on your phone if one appears. This can take a couple of minutes."
              : needsSetup
                ? "Not set up yet — add your Robinhood sign-in."
                : "Not connected — reconnect to resume live data."}
        </span>
      </div>

      {status.lastAttemptAt && (
        <p className="text-[11px] text-muted">
          Last login attempt: <span className="text-text">{relativeTime(status.lastAttemptAt, now)}</span>{" "}
          ({new Date(status.lastAttemptAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })})
        </p>
      )}

      {/* what went wrong, in the login guard's own categories */}
      {!connected && !connecting && status.lastErrorType === "rate_limited" && (
        <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          Robinhood rejected the last login for too many requests (HTTP 429). Wait at least 15 minutes before
          pressing Reconnect — trying again sooner extends the block.
        </p>
      )}
      {!connected && !connecting && status.lastErrorType === "auth_failed" && (
        <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          Robinhood rejected the sign-in itself. Check the username and password below, then reconnect.
        </p>
      )}
      {!connected && !connecting && status.lastErrorType === "unknown" && (
        <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          The last login failed{status.error ? `: ${status.error}` : "."} The bridge&apos;s log has the detail.
        </p>
      )}
      {!connected && !connecting && status.manualRequired && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/30">
          Automatic login retries are paused after {status.consecutiveFailures || 1} failed attempt
          {status.consecutiveFailures === 1 || !status.consecutiveFailures ? "" : "s"}, so the bridge doesn&apos;t
          get your account rate-limited. Press <strong>Reconnect Robinhood</strong> when you&apos;re ready.
        </p>
      )}
      {!connected && !connecting && !status.manualRequired && timeLocked && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/30">
          Login retries are cooling down until{" "}
          {new Date(status.lockedUntil as string).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.
        </p>
      )}

      {/* 1) Sign-in form: first run, or replacing what's on file */}
      {showForm && (
        <form onSubmit={saveSetup} className="space-y-3">
          <p className="text-xs text-muted">
            Your Robinhood username and password are written straight into the bridge&apos;s own folder on this
            machine and never read back or shown again. They go nowhere except Robinhood.
          </p>
          <div>
            <label className={labelClass()} htmlFor="rh-username">Username (email)</label>
            <input
              id="rh-username"
              className={inputClass()}
              autoComplete="username"
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
              className={inputClass()}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button type="button" className="text-[11px] text-muted underline" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide" : "Advanced"} — authenticator setup key
          </button>
          {showAdvanced && (
            <div>
              <label className={labelClass()} htmlFor="rh-totp">Authenticator setup key (optional)</label>
              <input
                id="rh-totp"
                type="password"
                className={inputClass()}
                autoComplete="off"
                value={totpSecret}
                onChange={(e) => setTotpSecret(e.target.value)}
                placeholder="the long key, not a 6-digit code"
              />
              <p className="mt-1 text-[11px] text-muted">
                Only if your Robinhood account uses an authenticator app: the long setup key Robinhood showed when
                you enabled it. Leave blank to approve logins from the Robinhood app on your phone instead.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy === "setup" || !username.trim() || !password} className={pillButton()}>
              {busy === "setup" ? "Saving…" : "Save & sign in"}
            </button>
            {editing && (
              <button type="button" className="text-[11px] text-muted underline" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* 2) Reconnect (a sign-in is on file) */}
      {!showForm && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Signed in as <span className="text-text">{status.username ?? "your saved account"}</span>
            {status.hasTotp ? " · authenticator key on file" : ""}.{" "}
            <button type="button" className="underline" onClick={() => setEditing(true)}>
              Change sign-in
            </button>
          </p>
          <button onClick={reconnect} disabled={busy === "reconnect" || connecting} className={pillButton()}>
            {busy === "reconnect" ? "Requesting…" : connecting ? "Signing in…" : "Reconnect Robinhood"}
          </button>
          <p className="text-[11px] text-muted">
            Robinhood sessions last a few days to a few weeks. Reconnect makes one fresh login attempt; unless an
            authenticator key is on file, Robinhood sends an approval prompt to your phone — approve it within two
            minutes.
          </p>
        </div>
      )}

      {/* messages */}
      {msg && (
        <p className={"text-xs " + (msg.kind === "ok" ? "text-emerald-400" : "text-rose-400")}>{msg.text}</p>
      )}
    </div>
  );
}
