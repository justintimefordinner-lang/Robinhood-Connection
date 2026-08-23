// MES direction card for the VIX tab — the last five sessions of the E-mini S&P
// (ES=F) as a line, with the least-squares slope beside it. Deliberately mirrors
// the S5FI weekly plot's formatting so the two read as one family.
import { Card, SectionTitle } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { fmtMes, type MesQuote } from "@/lib/mes-data";

// ISO yyyy-mm-dd → "Aug 21" (built from parts to avoid a UTC-parse day shift).
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MesTracker({ mes }: { mes: MesQuote }) {
  const up = mes.slope >= 0;
  const slopeColor = up ? "text-emerald-300" : "text-rose-300";
  const first = mes.daily[0]?.close ?? 0;
  const lastClose = mes.daily[mes.daily.length - 1]?.close ?? 0;
  const windowPct = first > 0 ? ((lastClose - first) / first) * 100 : 0;

  return (
    <>
      <SectionTitle>S&amp;P futures (MES)</SectionTitle>
      <Card className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wide text-muted">ES/MES</span>
            <span className="tabular text-lg font-bold leading-none">{fmtMes(mes.last)}</span>
          </div>
          {mes.changePct != null && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                mes.changePct >= 0
                  ? "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40"
                  : "bg-rose-500/20 text-rose-200 ring-rose-500/40"
              }`}
            >
              {mes.changePct >= 0 ? "+" : "−"}
              {(Math.abs(mes.changePct) * 100).toFixed(2)}% today
            </span>
          )}
          <span className={`ml-auto shrink-0 text-[11px] font-semibold ${slopeColor}`}>
            {up ? "↑" : "↓"} {up ? "rising" : "falling"}
          </span>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
            <span>Daily closes · last {mes.daily.length} sessions</span>
            <span className={slopeColor}>
              slope {mes.slope >= 0 ? "+" : "−"}
              {Math.abs(mes.slope).toFixed(1)}/day · {windowPct >= 0 ? "+" : "−"}
              {Math.abs(windowPct).toFixed(2)}%
            </span>
          </div>
          <div className="h-12 overflow-hidden rounded-md bg-surface/50 px-1 ring-1 ring-inset ring-border">
            <Sparkline
              data={mes.daily.map((d) => ({ label: dayLabel(d.date), value: d.close }))}
              height={48}
              positive={up}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[9px] text-muted/70">
            <span>{dayLabel(mes.daily[0].date)}</span>
            <span>{dayLabel(mes.daily[mes.daily.length - 1].date)}</span>
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Five-session direction of the S&amp;P 500 futures — the overnight tape the cash
          market opens against. Quoted from the E-mini (ES), which tracks the same index as
          the Micro (MES) at five times the contract size.
        </p>
      </Card>
    </>
  );
}
