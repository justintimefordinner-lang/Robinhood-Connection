// MES plot for the volatility indicator list — the last five sessions of the
// E-mini S&P (ES=F) as a line with its least-squares slope. Deliberately mirrors
// the S5FI weekly chart's framing so the two read as one family.
import { Sparkline } from "@/components/charts";
import type { MesQuote } from "@/lib/mes-data";

// ISO yyyy-mm-dd → "Aug 21" (built from parts to avoid a UTC-parse day shift).
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MesChart({ mes }: { mes: MesQuote }) {
  const up = mes.slope >= 0;
  const slopeColor = up ? "text-emerald-300" : "text-rose-300";
  const first = mes.daily[0]?.close ?? 0;
  const lastClose = mes.daily[mes.daily.length - 1]?.close ?? 0;
  const windowPct = first > 0 ? ((lastClose - first) / first) * 100 : 0;

  return (
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
  );
}
