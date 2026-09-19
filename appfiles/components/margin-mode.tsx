"use client";

// Persisted toggle for whether the VIX "portfolio fit" counts options buying
// power on top of liquidity (for margin users) or liquidity only. Stored in
// localStorage so it survives navigation and reloads. Shared by the home card and
// the VIX page.
//
// Defaults ON for a real account, but OFF whenever the app is showing the example
// dataset: a demo should present the plain liquidity picture rather than one that
// assumes the viewer trades on margin. An explicit choice still wins and persists.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEMO_MODE, isExampleClient } from "@/lib/demo";

type Ctx = { marginAware: boolean; setMarginAware: (v: boolean) => void };

const MarginModeContext = createContext<Ctx>({ marginAware: true, setMarginAware: () => {} });
const KEY = "marginAware";

export function MarginModeProvider({ children }: { children: ReactNode }) {
  // DEMO_MODE is known at build time, so a pinned demo starts liquidity-only with
  // no flash. The cookie case can only be read on the client, below.
  const [marginAware, setState] = useState(!DEMO_MODE);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v != null) {
        setState(v === "1"); // an explicit choice always wins
        return;
      }
    } catch {
      /* ignore */
    }
    if (isExampleClient()) setState(false);
  }, []);

  const setMarginAware = (v: boolean) => {
    setState(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return <MarginModeContext.Provider value={{ marginAware, setMarginAware }}>{children}</MarginModeContext.Provider>;
}

export function useMarginMode() {
  return useContext(MarginModeContext);
}
