"use client";

// Home hero: Total value + the value-history area chart, with press-and-drag
// scrubbing. Press-and-hold on the chart shows the "was" value and %-change at
// that past point (measured from the start of the shown window); releasing snaps
// back to the live total and trailing delta. A thin client island so the
// server-rendered home page stays server-rendered around it.
import { useState } from "react";
import { Card, Delta } from "@/components/ui";
import { Amt } from "@/components/privacy";
import { InteractiveSparkline } from "@/components/InteractiveSparkline";
import { fmtMoney } from "@/lib/calc";
import type { ValuePoint } from "@/lib/types";

export function HomeHero({
  totalValue,
  valueHistory,
  trailingDelta,
  trendPct,
}: {
  totalValue: number;
  valueHistory: ValuePoint[];
  trailingDelta: number;
  trendPct: number;
}) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  const scrubPoint =
    scrubIdx !== null && scrubIdx >= 0 && scrubIdx < valueHistory.length ? valueHistory[scrubIdx] : null;
  const first = valueHistory[0]?.value ?? 0;
  const scrubDelta = scrubPoint ? scrubPoint.value - first : 0;
  const scrubPct = scrubPoint && first ? scrubDelta / first : 0;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="px-4 pt-4">
        <div className="text-xs text-muted">Total value</div>
        <div className="tabular mt-0.5 text-3xl font-bold">
          <Amt>{fmtMoney(scrubPoint ? scrubPoint.value : totalValue)}</Amt>
        </div>
        <div className="mt-1 text-sm">
          {scrubPoint ? (
            <>
              <Delta value={scrubDelta} pct={scrubPct} />
              <span className="ml-1 text-xs text-muted">{scrubPoint.label} · since start</span>
            </>
          ) : (
            <>
              <Delta value={trailingDelta} pct={trendPct} />
              <span className="ml-1 text-xs text-muted">trailing (illustrative)</span>
            </>
          )}
        </div>
      </div>
      <div className="mt-2">
        <InteractiveSparkline data={valueHistory} positive={trendPct >= 0} onScrub={setScrubIdx} />
      </div>
    </Card>
  );
}
