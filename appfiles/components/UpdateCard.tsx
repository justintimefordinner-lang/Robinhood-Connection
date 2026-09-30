"use client";

// Settings → "Update available". Shows what changed since the running build and
// updates in one press. The press only drops a marker; the updater container
// pulls the new images and recreates the stack, and this page waits for the new
// build to come up, then reloads into it.
import { useCallback, useEffect, useRef, useState } from "react";

interface Check {
  enabled: boolean;
  current: string;
  latest: string | null;
  available: boolean;
  publishedAt: string | null;
  changes: string[];
  checkedAt: string | null;
  error: string | null;
}
interface Status {
  status: "idle" | "requested" | "running" | "done" | "error";
  message: string | null;
}

const btn = "rounded-full bg-sky-500/15 px-4 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-inset ring-sky-500/30 active:bg-sky-500/25 disabled:opacity-50";

export function UpdateCard() {
  const [check, setCheck] = useState<Check | null>(null);
  const [phase, setPhase] = useState<"idle" | "requested" | "running" | "restarting" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const startedAt = useRef(0);

  const load = useCallback(async (force = false) => {
    setChecking(true);
    try {
      const r = await fetch(`/api/update/check${force ? "?force=1" : ""}`, { cache: "no-store" });
      if (r.ok) setCheck((await r.json()) as Check);
    } catch {
      // offline: leave whatever we had
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // After the press: follow the updater's status file, then wait for a build
  // with a different sha to answer, then reload into it.
  useEffect(() => {
    if (phase === "idle" || phase === "done" || phase === "error") return;
    const id = setInterval(async () => {
      if (Date.now() - startedAt.current > 10 * 60_000) {
        setPhase("error");
        setMessage("The update is taking longer than ten minutes. Check docker compose ps in the install folder.");
        return;
      }
      try {
        if (phase !== "restarting") {
          const s = (await (await fetch("/api/update/status", { cache: "no-store" })).json()) as Status;
          if (s.status === "error") {
            setPhase("error");
            setMessage(s.message || "The updater reported a failure.");
            return;
          }
          if (s.status === "running") setPhase("running");
          if (s.status === "done") setPhase("restarting");
          return;
        }
        const c = (await (await fetch("/api/update/check", { cache: "no-store" })).json()) as Check;
        if (check && c.current && c.current !== check.current) {
          setPhase("done");
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch {
        // the dashboard container is being replaced; keep polling
        if (phase !== "restarting") setPhase("restarting");
      }
    }, 3000);
    return () => clearInterval(id);
  }, [phase, check]);

  async function apply() {
    setMessage("");
    startedAt.current = Date.now();
    try {
      const r = await fetch("/api/update/apply", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || "Request failed.");
      setPhase("requested");
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "Request failed.");
    }
  }

  if (!check || !check.enabled) return null;

  const busy = phase === "requested" || phase === "running" || phase === "restarting";
  const when = check.publishedAt ? new Date(check.publishedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className={`rounded-2xl border px-4 py-3 ${check.available ? "border-sky-500/40 bg-sky-500/10" : "border-border bg-surface"}`}>
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold">{check.available ? "Update available" : "Up to date"}</span>
          <span className="mt-0.5 block text-xs text-muted">
            Running build {check.current}
            {check.available && check.latest ? ` · ${check.latest} published${when ? ` ${when}` : ""}` : ""}
            {check.error ? ` · couldn't reach GitHub: ${check.error}` : ""}
          </span>
        </span>
        {!check.available && (
          <button onClick={() => load(true)} disabled={checking} className="shrink-0 text-[11px] text-muted underline disabled:opacity-50">
            {checking ? "Checking…" : "Check now"}
          </button>
        )}
      </div>

      {check.available && check.changes.length > 0 && phase === "idle" && (
        <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted">
          {check.changes.map((c, i) => (
            <li key={i}>· {c}</li>
          ))}
        </ul>
      )}

      {check.available && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={apply} disabled={busy || phase === "done"} className={btn}>
            {phase === "idle" || phase === "error" ? "Update now" : phase === "requested" ? "Requested…" : phase === "running" ? "Pulling images…" : phase === "restarting" ? "Restarting…" : "Updated"}
          </button>
          {phase === "idle" && <span className="text-[11px] text-muted">Pulls the new images and restarts both containers. About a minute; the page reloads by itself.</span>}
          {phase === "requested" && <span className="text-[11px] text-muted">Waiting for the updater to pick it up (it looks every 10 seconds).</span>}
          {phase === "running" && <span className="text-[11px] text-muted">Downloading. Data keeps flowing until the switch.</span>}
          {phase === "restarting" && <span className="text-[11px] text-muted">Containers are being replaced; this page will reload.</span>}
          {phase === "done" && <span className="text-[11px] text-emerald-400">Done. Reloading…</span>}
          {phase === "error" && <span className="text-[11px] text-rose-400">{message}</span>}
        </div>
      )}
    </div>
  );
}
