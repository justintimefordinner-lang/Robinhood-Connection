"use client";

// Refresh interval controls: read/write in minutes for readability, stored
// as seconds in .env. auto_push.py re-reads these from .env every ~5s while
// running, so changes here apply on their own — no restart needed.
import { useState } from "react";

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

export function SettingsForm({ initialIntervals }: { initialIntervals: Intervals }) {
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
    <form onSubmit={save} className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Refresh intervals</h2>
      <p className="mt-1 text-xs text-muted">
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
