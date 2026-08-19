"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedStatus } from "@/lib/refresh-status";

export function StopwatchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`-mt-px inline-block shrink-0 ${className}`}
    >
      <path d="M9 2h6" />
      <path d="M12 2v2" />
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9.5v3.5l2 2" />
    </svg>
  );
}

function WarningIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`-mt-px inline-block shrink-0 ${className}`}
    >
      <path d="M12 9v4" />
      <path d="M10.3 3.9 2.5 17a1.6 1.6 0 0 0 1.4 2.4h16.2a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}

function relativeTime(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((nowMs - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Live count to the next data refresh. Two independent ways to drive it:
//   - `status`: a FeedStatus from getRefreshStatus() (the scheduler file) -
//     used by every page-level caller. Also unlocks the failure display: if
//     status.status === "error", this shows a red "failed Xm ago" badge
//     instead of a countdown, with the message on hover/long-press.
//   - `nextAt` + `cadence`: a plain ISO timestamp, for the one caller
//     (the in-report CSP ladder timer in AmReportView) whose "next refresh"
//     is computed per-report by am_report.py rather than read from the
//     scheduler file, and which has its own "fast cadence" (active tape)
//     styling that isn't a failure state and shouldn't be conflated with one.
//
// Ticks each second; shows minutes (the "#"), drops to seconds in the last
// minute. When it expires it does a soft `router.refresh()` — re-runs the
// server component and re-reads the JSON, no full reload/flicker — so the
// screen tracks the file automatically. Stops auto-refreshing if the data is
// very stale (pusher down).
export function DataRefresh({
  status,
  nextAt,
  cadence,
  autoRefresh = true,
}: {
  status?: FeedStatus;
  nextAt?: string;
  cadence?: "fast" | "base";
  autoRefresh?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number>(() => Date.now());
  const lastRefresh = useRef<number>(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const effectiveNextAt = status?.nextAt ?? nextAt;
  const target = effectiveNextAt ? new Date(effectiveNextAt).getTime() : NaN;
  const valid = !Number.isNaN(target);
  const expiredForMs = valid ? now - target : 0;
  // only auto-refresh in the window just after expiry (≤5 min); beyond that the
  // pusher is probably stopped, so don't loop forever.
  const justExpired = valid && expiredForMs >= 0 && expiredForMs <= 300_000;

  useEffect(() => {
    if (!autoRefresh || !justExpired) return;
    if (now - lastRefresh.current > 8_000) {
      lastRefresh.current = now;
      router.refresh();
    }
  }, [autoRefresh, justExpired, now, router]);

  if (status?.status === "error") {
    const attemptedAt = status.lastAttemptAt;
    const rel = attemptedAt ? relativeTime(attemptedAt, now) : "";
    return (
      <span
        title={status.error ? `Last attempt failed: ${status.error}` : "Last attempt failed"}
        className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-rose-500/20 px-1 py-0.5 align-middle text-[9px] font-semibold tabular text-rose-200"
      >
        <WarningIcon /> failed{rel ? ` ${rel}` : ""}
      </span>
    );
  }

  if (!valid) return null;
  const secs = Math.round((target - now) / 1000);
  const text =
    secs > 0 ? (secs < 60 ? `${secs}s` : `${Math.ceil(secs / 60)}m`) : expiredForMs <= 300_000 ? "updating…" : "stale";
  const hot = cadence === "fast";

  return (
    <span
      title={hot ? "Fast cadence — active tape" : "Next data refresh"}
      className={`ml-1.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 align-middle text-[9px] font-semibold tabular ${
        hot ? "bg-rose-500/20 text-rose-200" : "bg-surface-2 text-muted"
      }`}
    >
      <StopwatchIcon /> {text}
    </span>
  );
}
