"use client";

// A small dot on the Settings button when a newer build is published. Asks the
// app once per page load; the server caches the GitHub answer for five hours, so
// this costs nothing to show everywhere.
import { useEffect, useState } from "react";

export function UpdateDot() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/update/check", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setAvailable(!!d?.available))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!available) return null;
  return (
    <span
      aria-label="Update available"
      title="Update available"
      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-sky-400 ring-2 ring-bg"
    />
  );
}
