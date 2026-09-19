import { Card, SectionTitle } from "@/components/ui";
import { Amt } from "@/components/privacy";
import { fmtMoney } from "@/lib/calc";
import type { PortfolioRisk, SectorBucket, RiskRules } from "@/lib/types";

// Sector bars ported from jttyeung's fork (components/PortfolioRiskView.tsx on
// her staging branch). The cap the bars are judged against comes from
// `risk.rules`, never from a literal here.

function tickerList(b: SectorBucket): string {
  const names = b.tickers.map((t) => t.symbol);
  return names.length > 6 ? `${names.slice(0, 6).join(" · ")} +${names.length - 6}` : names.join(" · ");
}

export function SectorBars({ sectors, rules, compact = false }: { sectors: SectorBucket[]; rules: RiskRules; compact?: boolean }) {
  if (sectors.length === 0) {
    return <p className="text-[11px] text-muted">No sector exposure from current positions.</p>;
  }
  const hasUnclassified = sectors.some((b) => b.unclassified);
  return (
    <div className="space-y-2">
      {sectors.map((b) => {
        const tone = b.over ? "text-rose-300" : b.unclassified ? "text-amber-300" : "";
        return (
          <div key={b.sector}>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className={`min-w-0 truncate ${tone} ${b.over ? "font-semibold" : ""}`}>{b.sector}</span>
              <span className={`tabular shrink-0 ${b.over ? "font-semibold text-rose-300" : "text-muted"}`}>
                <Amt>{fmtMoney(b.value)}</Amt> · {(b.pct * 100).toFixed(1)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${b.over ? "bg-rose-400" : b.unclassified ? "bg-amber-400/70" : "bg-sky-400"}`} style={{ width: `${Math.min(100, b.pct * 100)}%` }} />
            </div>
            {!compact && <div className="mt-0.5 truncate text-[10px] text-muted">{tickerList(b)}</div>}
          </div>
        );
      })}
      <p className="pt-1 text-[10px] text-muted">
        Sector cap: {(rules.sector.maxAllocationPct * 100).toFixed(0)}% of portfolio value per sector. Capital counts stock
        value, CSP collateral, LEAP market value and spread risk — the same figures as the Holdings table.
      </p>
      {hasUnclassified && !compact && (
        <p className="text-[10px] text-amber-300/80">
          Unclassified tickers have no sector from Yahoo yet — the bridge fills a few per cycle. Place any by hand under{" "}
          <span className="font-mono">overrides</span> in <span className="font-mono">data/sectors.json</span>.
        </p>
      )}
    </div>
  );
}

export function PortfolioRiskView({ risk }: { risk: PortfolioRisk }) {
  const { portfolioValue, accountCount, sectors, rules } = risk;
  return (
    <div>
      <SectionTitle>Sector concentration</SectionTitle>
      <Card className="px-4 py-4">
        <div className="mb-3 text-[10px] text-muted">
          <Amt>{fmtMoney(portfolioValue)}</Amt> total across {accountCount} account{accountCount === 1 ? "" : "s"}
        </div>
        <SectorBars sectors={sectors} rules={rules} />
      </Card>
    </div>
  );
}
