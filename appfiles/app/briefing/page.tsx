import { PageHeader, Card } from "@/components/ui";
import { AmReportView } from "@/components/AmReportView";
import { getAmReport } from "@/lib/am-report";
import { getSnapshot } from "@/lib/snapshot";
import { getSelectedAccount } from "@/lib/account";
import { computeHoldings, underweightTickers } from "@/lib/holdings";
import { getRefreshStatus } from "@/lib/refresh-status";
import { DataRefresh } from "@/components/DataRefresh";
import { AmRefreshButton } from "@/components/AmRefreshButton";

export const dynamic = "force-dynamic";

function asOfLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export default async function BriefingPage() {
  const report = getAmReport();
  // Names sitting under 8.5% of the selected account, plus everything held in any
  // form — the Brief green-flags board rows that are underweight (room to add) or
  // high-conviction and unheld. Same overlap the Portfolio page tags.
  const snap = await getSnapshot();
  const { data } = await getSelectedAccount(snap);
  const underweight = underweightTickers(computeHoldings(data));
  const book = Array.from(
    new Set([...data.equities.map((e) => e.symbol.toUpperCase()), ...data.options.map((o) => o.symbol.toUpperCase())]),
  );

  return (
    <main className="px-4">
      <PageHeader
        title="Morning Brief"
        subtitle={
          report ? (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span>Pre-open · {report.meta.passed} on board · {asOfLabel(report.meta.asOf)}</span>
              <DataRefresh status={getRefreshStatus().am_report} />
            </span>
          ) : (
            "Run am_report.py to build the report"
          )
        }
        right={report ? <AmRefreshButton asOf={report.meta.asOf} /> : undefined}
      />
      {report ? (
        <AmReportView report={report} underweight={underweight} book={book} />
      ) : (
        <Card className="mt-3 px-4 py-4 text-[12px] leading-relaxed text-muted">
          No briefing yet. Run <span className="font-mono">python am_report.py</span> (or add it to auto_push) to
          build the regime gate, CSP board, VRP heat map, and gamma walls from your Robinhood market data.
        </Card>
      )}
    </main>
  );
}
