"use client";

// Force-refresh button for the Morning Brief. Same request/poll pattern as
// components/RefreshButton.tsx (the portfolio snapshot's refresh button), but
// targets the am_report feed: tapping it hits /api/am-refresh, which spawns
// am_report.py directly (no Claude Code needed — the script already talks to
// Robinhood on its own). It then polls /api/am-status until report.meta.asOf
// moves past the request's timestamp, at which point it calls router.refresh().
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "requesting" | "pending" | "updated";

function tzAbbrev(d: Date): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(d);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function fmtStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${p(d.getMonth() + 1)}/${p(d.getDate())}/${String(d.getFullYear()).slice(-2)}`;
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
  const tz = tzAbbrev(d);
  return `${date} ${time}${tz ? ` ${tz}` : ""}`;
}

export function AmRefreshButton({ asOf }: { asOf: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [baseline] = useState(asOf);
  const stamp = fmtStamp(asOf);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Distinguish a real tap from a swipe (pull-to-refresh): a drag that started on
  // the button must NOT queue a refresh — only a deliberate tap does.
  const draggedRef = useRef(false);
  const startYRef = useRef(0);

  // on mount, reflect any already-pending request
  useEffect(() => {
    fetch("/api/am-status")
      .then((r) => r.json())
      .then((s) => {
        if (s.pending) {
          setPhase("pending");
          startPolling();
        }
      })
      .catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await (await fetch("/api/am-status")).json();
        if (s.asOf && s.asOf !== baseline && !s.pending) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase("updated");
          router.refresh();
          setTimeout(() => setPhase("idle"), 2500);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);
  }

  async function requestRefresh() {
    if (phase === "requesting" || phase === "pending") return;
    setPhase("requesting");
    try {
      const res = await fetch("/api/am-refresh", { method: "POST" });
      if (!res.ok) throw new Error();
      setPhase("pending");
      startPolling();
    } catch {
      setPhase("idle");
    }
  }

  // Only a clean tap queues a refresh; a swipe (e.g. pull-to-refresh that began
  // on the button) is ignored, so reloading the page never queues one.
  function handleClick() {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    requestRefresh();
  }

  const spinning = phase === "requesting" || phase === "pending";
  const label =
    phase === "updated"
      ? "Updated"
      : phase === "pending"
        ? "Refreshing…"
        : phase === "requesting"
          ? "Requesting…"
          : `Updated ${stamp}`;

  return (
    <button
      onClick={handleClick}
      onTouchStart={(e) => {
        draggedRef.current = false;
        startYRef.current = e.touches[0]?.clientY ?? 0;
      }}
      onTouchMove={(e) => {
        if (Math.abs((e.touches[0]?.clientY ?? 0) - startYRef.current) > 8) draggedRef.current = true;
      }}
      disabled={spinning}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted ring-1 ring-inset ring-border active:bg-surface disabled:opacity-80"
      aria-label="Force-refresh the morning brief"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={spinning ? "animate-spin" : ""}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
      <span className={phase === "updated" ? "text-emerald-400" : ""} suppressHydrationWarning>{label}</span>
    </button>
  );
}
