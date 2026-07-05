import Link from "next/link";
import { Card, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { Donut } from "@/components/charts";
import type { DonutSlice } from "@/components/charts";
import { RefreshButton } from "@/components/RefreshButton";
import { Amt, ShowAmounts } from "@/components/privacy";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { getSnapshot } from "@/lib/snapshot";
import { getSelectedAccount } from "@/lib/account";
import { cspCollateral, fmtMoney, optionBasis, optionMarketValue, optionPnl } from "@/lib/calc";
import type { OptionPosition } from "@/lib/types";

const CSP_COLOR = "#38bdf8"; // sky — matches the CSP side accent
const LEAP_COLOR = "#a78bfa"; // violet — matches the LEAP side accent

export const dynamic = "force-dynamic";

const isCsp = (o: OptionPosition) => o.kind === "csp";
const isLeap = (o: OptionPosition) => o.kind === "leap-call" || o.kind === "leap-put-hedge";

// One tappable "side" — the whole column highlights on press so it's clear you're
// drilling into that entire strategy, not a single metric.
function SideCard({
  href,
  label,
  count,
  value,
  valueLabel = "Value",
  pnl,
  accent,
}: {
  href: string;
  label: string;
  count: number;
  value: number;
  valueLabel?: string;
  pnl: number;
  accent: "csp" | "leap" | "covered" | "spread";
}) {
  const a = {
    csp: "ring-sky-500/25 bg-sky-500/[0.06] group-hover:bg-sky-500/10 group-active:bg-sky-500/20 group-active:ring-sky-500/50",
    leap: "ring-violet-500/25 bg-violet-500/[0.06] group-hover:bg-violet-500/10 group-active:bg-violet-500/20 group-active:ring-violet-500/50",
    covered: "ring-emerald-500/25 bg-emerald-500/[0.06] group-hover:bg-emerald-500/10 group-active:bg-emerald-500/20 group-active:ring-emerald-500/50",
    spread: "ring-amber-500/25 bg-amber-500/[0.06] group-hover:bg-amber-500/10 group-active:bg-amber-500/20 group-active:ring-amber-500/50",
  }[accent];
  return (
    <Link href={href} className="group block">
      <div className={`overflow-hidden rounded-2xl ring-1 ring-inset transition-colors ${a}`}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-sm font-semibold">
            {label} <span className="font-normal text-muted">· {count}</span>
          </span>
          <span className="text-muted">›</span>
        </div>
        <div className="border-t border-border/50 px-4 py-2.5">
          <div className="text-[11px] text-muted">{valueLabel}</div>
          <div className="tabular text-base font-semibold">
            <Amt>{fmtMoney(value)}</Amt>
          </div>
        </div>
        <div className="border-t border-border/50 px-4 py-2.5">
          <div className="text-[11px] text-muted">Gain/Loss</div>
          <div className={`tabular text-base font-semibold ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            <Amt>{`${pnl >= 0 ? "+" : "−"}${fmtMoney(Math.abs(pnl))}`}</Amt>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default async function OptionsPage() {
  const snap = await getSnapshot();
  const { id, data } = await getSelectedAccount(snap);
  const { options } = data;

  const sum = (os: OptionPosition[], f: (o: OptionPosition) => number) => os.reduce((s, o) => s + f(o), 0);
  const csps = options.filter(isCsp);
  const leaps = options.filter(isLeap);
  const covered = options.filter((o) => o.kind === "covered-call");
  const spreads = options.filter((o) => o.kind === "put-spread" || o.kind === "call-spread");

  const allValue = sum(options, optionMarketValue);
  const allPnl = sum(options, optionPnl);

  // Strategy allocation by capital deployed: CSP collateral (cash-secured) vs
  // current LEAP market value. (Raw CSP contract value would read ~2% and hide
  // how much capital the wheel actually ties up.)
  const cspCapital = sum(csps, cspCollateral);
  const leapCapital = sum(leaps, optionMarketValue);
  const stratTotal = cspCapital + leapCapital;
  const allocation: DonutSlice[] = [
    { label: "CSPs", value: cspCapital, color: CSP_COLOR },
    { label: "LEAPs", value: leapCapital, color: LEAP_COLOR },
  ];

  return (
    <main className="px-4">
      <ShowAmounts>
        <PageHeader
          title="Options"
          subtitle={
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <AccountSwitcher accounts={snap.accounts} selectedId={id} />
              <span>· {options.length} positions</span>
            </span>
          }
          right={<RefreshButton generatedAt={snap.meta.generatedAt} />}
        />

        {/* Strategy allocation — CSP vs LEAP share of deployed capital */}
        {options.length > 0 && (
          <Card className="mt-4 px-4 py-4">
            <div className="flex items-center gap-4">
              <Donut slices={allocation} centerTop={<Amt>{fmtMoney(stratTotal)}</Amt>} centerBottom="capital" />
              <ul className="flex-1 space-y-3">
                {allocation.map((s) => {
                  const pct = stratTotal > 0 ? s.value / stratTotal : 0;
                  return (
                    <li key={s.label}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="tabular font-semibold">{Math.round(pct * 100)}%</span>
                      </div>
                      <div className="tabular mt-0.5 pl-[18px] text-[11px] text-muted">
                        <Amt>{fmtMoney(s.value)}</Amt>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="mt-3 border-t border-border pt-2 text-[11px] leading-relaxed text-muted">
              Share of capital deployed by strategy — CSP collateral (cash-secured) vs current LEAP market value.
            </p>
          </Card>
        )}

        {/* All options */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Market value" value={<Amt>{fmtMoney(allValue)}</Amt>} sub="all options" />
          <Stat
            label="Gain/Loss"
            value={<Amt>{`${allPnl >= 0 ? "+" : "−"}${fmtMoney(Math.abs(allPnl))}`}</Amt>}
            tone={allPnl >= 0 ? "pos" : "neg"}
            sub="unrealized"
          />
        </div>

        {/* CSP side (left) vs LEAP side (right) — tap anywhere on a side to drill in */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SideCard
            href="/options/csp"
            label="CSPs"
            count={csps.length}
            value={sum(csps, optionBasis)}
            valueLabel="Premium received"
            pnl={sum(csps, optionPnl)}
            accent="csp"
          />
          <SideCard
            href="/options/leap"
            label="LEAPs"
            count={leaps.length}
            value={sum(leaps, optionMarketValue)}
            pnl={sum(leaps, optionPnl)}
            accent="leap"
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <SideCard
            href="/options/covered"
            label="Covered"
            count={covered.length}
            value={sum(covered, optionBasis)}
            valueLabel="Premium received"
            pnl={sum(covered, optionPnl)}
            accent="covered"
          />
          <SideCard
            href="/options/spread"
            label="Spreads"
            count={spreads.length}
            value={sum(spreads, optionMarketValue)}
            valueLabel="Net value"
            pnl={sum(spreads, optionPnl)}
            accent="spread"
          />
        </div>

        <SectionTitle>How this works</SectionTitle>
        <p className="-mt-1 px-1 text-[11px] leading-relaxed text-muted">
          Tap the <span className="text-sky-300">CSP</span> or <span className="text-violet-300">LEAP</span> side to open
          a focused view — positions default to <span className="text-text">Open</span>; flip the toggle to{" "}
          <span className="text-text">Closed</span> for that type&apos;s realized round-trips, and find new ideas from
          inside that view. Keeps the page glanceable no matter how many positions you carry.
        </p>
      </ShowAmounts>
    </main>
  );
}
