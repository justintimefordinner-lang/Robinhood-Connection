import { BackLink, PageHeader } from "@/components/ui";
import { ShowAmounts } from "@/components/privacy";
import { PortfolioRiskView } from "@/components/PortfolioRiskView";
import { DataRefresh } from "@/components/DataRefresh";
import { getSnapshot } from "@/lib/snapshot";
import { getSectorMap } from "@/lib/sectors";
import { computePortfolioRisk } from "@/lib/portfolio-risk";
import { getRefreshStatus } from "@/lib/refresh-status";

export const dynamic = "force-dynamic";

// Whole-portfolio view on purpose: sector concentration is judged across every
// account (all bridges), not the one the switcher has selected — a sector cap
// you only breach when the accounts are summed is still breached.
export default async function RiskPage() {
  const [snap, sectors] = await Promise.all([getSnapshot(), getSectorMap()]);
  const risk = computePortfolioRisk(snap, sectors);

  return (
    <main className="px-4">
      <ShowAmounts>
        <PageHeader
          title="Portfolio Risk"
          subtitle={
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span>Capital per sector against a {(risk.rules.sector.maxAllocationPct * 100).toFixed(0)}% cap</span>
              <DataRefresh nextAt={getRefreshStatus().app?.nextAt} />
            </span>
          }
          right={<BackLink />}
        />
        <PortfolioRiskView risk={risk} />
      </ShowAmounts>
    </main>
  );
}
