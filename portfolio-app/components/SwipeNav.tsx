"use client";

import { useRouter, usePathname } from "next/navigation";
import { useRef, useTransition, type ReactNode } from "react";

// Same order as BottomNav's TABS — keep these in sync.
const TAB_ORDER = ["/", "/options", "/pnl", "/vix", "/briefing", "/research"];

// Mirrors BottomNav's "active" logic: "/" is exact, everything else is a
// startsWith match, so a sub-page like /options/csp still counts as "Options"
// for swipe purposes.
function currentTabIndex(pathname: string): number {
  if (pathname === "/") return 0;
  for (let i = 1; i < TAB_ORDER.length; i++) {
    if (pathname.startsWith(TAB_ORDER[i])) return i;
  }
  return -1; // unrecognized route — don't swipe-nav from here
}

// Walk up from the touch target: if it's inside something that itself
// scrolls horizontally (e.g. a wide table with overflow-x-auto), let that
// element have the gesture instead of hijacking it for tab navigation.
function isInsideHorizontalScroller(target: EventTarget | null): boolean {
  let node = target as HTMLElement | null;
  while (node && node !== document.body) {
    if (node.scrollWidth > node.clientWidth + 4) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

const MIN_DISTANCE_PX = 70; // ignore short brushes
const MAX_DURATION_MS = 600; // ignore slow drags (probably not an intentional swipe)
const HORIZONTAL_BIAS = 1.5; // dx must clearly dominate dy, not a diagonal scroll

// Minimal typing for the View Transitions API — not yet in every TS DOM lib
// version, and not every browser supports it (notably Safari/iOS as of
// writing). Where it's missing, `navigate()` below just falls back to a
// plain instant router.push with no animation — nothing breaks either way.
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

export function SwipeNav({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const start = useRef<{ x: number; y: number; t: number; skip: boolean } | null>(null);
  // Continuously updated during the gesture so a touchcancel (which some
  // browsers fire instead of touchend once they decide to hand a touch off
  // to native scrolling) still has a last-known position to finish with,
  // instead of silently dropping the swipe.
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  function navigate(path: string, direction: "left" | "right") {
    const doc = document as ViewTransitionDocument;
    if (!doc.startViewTransition) {
      router.push(path);
      return;
    }
    // The slide direction the CSS keyframes key off of (see globals.css).
    document.documentElement.dataset.swipeDir = direction;
    const transition = doc.startViewTransition(() => {
      // startViewTransition needs to know when the DOM actually reflects the
      // new route before it captures the "after" snapshot. Wrapping
      // router.push in React's own transition and resolving once it's
      // committed is the reliable way to signal that (same approach
      // small view-transition helper libraries use under the hood).
      return new Promise<void>((resolve) => {
        startTransition(() => {
          router.push(path);
          resolve();
        });
      });
    });
    transition.finished.finally(() => {
      delete document.documentElement.dataset.swipeDir;
    });
  }

  function finish(x: number, y: number) {
    const s = start.current;
    start.current = null;
    lastPos.current = null;
    if (!s || s.skip) return;

    const dx = x - s.x;
    const dy = y - s.y;
    const dt = Date.now() - s.t;
    if (Math.abs(dx) < MIN_DISTANCE_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_BIAS) return;
    if (dt > MAX_DURATION_MS) return;

    const idx = currentTabIndex(pathname);
    if (idx === -1) return;
    const nextIdx = dx < 0 ? idx + 1 : idx - 1; // swipe left -> next tab, swipe right -> previous
    if (nextIdx < 0 || nextIdx >= TAB_ORDER.length) return;
    navigate(TAB_ORDER[nextIdx], dx < 0 ? "left" : "right");
  }

  return (
    <div
      // touch-pan-y: this container now scrolls vertically on its own (not
      // the document) on any page tall enough to need it — Brief being the
      // main one. Without this, the browser is free to interpret an
      // ambiguous/fast horizontal drag as the start of a native vertical
      // scroll and hijack the touch sequence (often delivering touchcancel
      // instead of touchend, so the swipe below never gets detected).
      // touch-action: pan-y tells it to only ever claim vertical gestures
      // natively here, leaving horizontal drags entirely to this handler.
      className={`touch-pan-y ${className ?? ""}`}
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = {
          x: t.clientX,
          y: t.clientY,
          t: Date.now(),
          skip: isInsideHorizontalScroller(e.target),
        };
        lastPos.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) lastPos.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        finish(t.clientX, t.clientY);
      }}
      onTouchCancel={() => {
        // Fall back to the last position seen before the browser cancelled
        // the sequence, rather than dropping the gesture entirely.
        if (lastPos.current) finish(lastPos.current.x, lastPos.current.y);
      }}
    >
      {children}
    </div>
  );
}
