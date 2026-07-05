"use client";

// "Example mode" toggle. Replaces the old hide/mask behavior: instead of masking
// figures, the whole app renders a self-consistent EXAMPLE dataset (see
// lib/example.ts) so it can be shown to others without exposing real values while
// keeping every feature fully functional. The button sets a cookie and refreshes
// so server-rendered values swap too.
import { useEffect, useState, type ReactNode } from "react";

const COOKIE = "exampleMode";

// ---- Legacy no-op shims kept so existing imports/usages don't need edits.
export function PrivacyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function ShowAmounts({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export const usePrivacy = () => ({ hidden: false, toggle: () => {} });

/** Passthrough now that values are swapped at the data layer in example mode. */
export function Amt({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}

function readCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === `${COOKIE}=1`);
}

/** Toggles example mode for demos. Exported also as HideButton for back-compat. */
export function ExampleButton() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(readCookie()), []);

  const toggle = () => {
    const next = !on;
    document.cookie = `${COOKIE}=${next ? "1" : "0"}; path=/; max-age=${next ? 31536000 : 0}; SameSite=Lax`;
    setOn(next);
    // Full reload (not a soft router.refresh) so the server re-renders with the
    // new cookie reliably in production and on mobile browsers.
    window.location.reload();
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={on}
      title={on ? "Switch back to real data" : "Show example data for a demo"}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors active:bg-surface ${
        on ? "bg-amber-500/15 text-amber-300 ring-amber-500/30" : "bg-surface-2 text-muted ring-border"
      }`}
    >
      <Beaker />
      <span>{on ? "Example on" : "Example"}</span>
    </button>
  );
}

// Back-compat alias: pages still import { HideButton }.
export { ExampleButton as HideButton };

function Beaker() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h6" />
      <path d="M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path d="M7.5 14h9" />
    </svg>
  );
}
