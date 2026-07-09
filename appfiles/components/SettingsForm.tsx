"use client";

// Settings page content: a small accordion-style menu. Each top-level item
// (e.g. "Refresh intervals", "Robinhood connection") is collapsed by default
// and expands on tap, so the page can grow more settings sections later
// without turning into one long scroll of unrelated controls.
import { useState, type ReactNode } from "react";

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
  const [status, setStatus] = useState<"idle" | "requesting" | "requested" | "error">("idle");
  const [error, setError] = useState("");

  async function reconnect() {
    setStatus("requesting");
    setError("");
    try {
      const res = await fetch("/api/robinhood-reconnect", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Request failed.");
      setStatus("requested");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  return (
    <div>
      <p className="text-xs text-muted">
        Clears the saved Robinhood session and forces a brand-new login. Use this if a login attempt
        was interrupted (e.g. you missed the device-approval push notification) and it doesn&apos;t
        seem to be retrying on its own.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={reconnect}
          disabled={status === "requesting"}
          className="rounded-full bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 active:bg-emerald-500/25 disabled:opacity-60"
        >
          {status === "requesting" ? "Requesting…" : "Reconnect Robinhood"}
        </button>
        {status === "requested" && (
          <span className="text-xs text-emerald-400">Requested — check your phone for a new approval prompt.</span>
        )}
        {status === "error" && <span className="text-xs text-rose-400">{error}</span>}
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
      <MenuItem title="Robinhood connection" subtitle="Force a fresh login if it's stuck">
        <RobinhoodSection />
      </MenuItem>
    </div>
  );
}
