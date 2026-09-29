import { useState } from "react";
import { useReports } from "@/api/hooks";
import { ErrorState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

export function ReportsPage() {
  const [days, setDays] = useState<Period>(7);
  const reports = useReports(days);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan mix, revenue and usage over a period you choose.</p>
        </div>
        <div role="radiogroup" aria-label="Period" className="inline-flex rounded-md border border-border bg-muted p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={days === p}
              data-testid={`reports-period-${p}`}
              onClick={() => setDays(p)}
              className={cn(
                "rounded-[5px] px-3 py-1 text-sm font-medium transition-colors",
                days === p ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p} days
            </button>
          ))}
        </div>
      </div>

      {reports.isError ? (
        <Card>
          <ErrorState message={reports.error.message} onRetry={() => void reports.refetch()} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="revenue-trend">
            <CardHeader>
              <CardTitle>Recharge revenue, last {days} days</CardTitle>
            </CardHeader>
            <CardContent>{reports.data ? <Sparkline data={reports.data.revenue_trend} /> : <Skeleton className="h-40" />}</CardContent>
          </Card>

          <Card data-testid="plan-distribution">
            <CardHeader>
              <CardTitle>Customers by plan</CardTitle>
            </CardHeader>
            <CardContent>
              {reports.data ? (
                reports.data.plan_distribution.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No plans yet.</p>
                ) : (
                  <PlanBars data={reports.data.plan_distribution} />
                )
              ) : (
                <Skeleton className="h-40" />
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2" data-testid="usage-by-type">
            <CardHeader>
              <CardTitle>Usage by type, last {days} days</CardTitle>
            </CardHeader>
            <CardContent>
              {reports.data ? (
                reports.data.usage_by_type.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No usage in this period.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {reports.data.usage_by_type.map((row) => (
                      <div key={row.call_type} className="rounded-md border border-border p-3">
                        <p className="text-xs font-medium capitalize text-muted-foreground">{row.call_type}</p>
                        <p className="tabular mt-1 text-xl font-semibold">{row.count}</p>
                        <p className="text-xs text-muted-foreground">{money(row.total_charge)} charged</p>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <Skeleton className="h-24" />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function PlanBars({ data }: { data: Array<{ plan_id: string; name: string; customers: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.customers));
  return (
    <ul className="flex flex-col gap-3">
      {data.map((plan) => (
        <li key={plan.plan_id} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 truncate text-muted-foreground" title={plan.name}>
            {plan.name}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${(plan.customers / max) * 100}%` }} />
          </div>
          <span className="tabular w-8 shrink-0 text-right font-medium">{plan.customers}</span>
        </li>
      ))}
    </ul>
  );
}

/** A line chart for a longer trend (bars get too dense past ~14 points). Built as inline SVG: no charting library
 * needed for one polyline, and it stays legible in both themes since it uses currentColor via the primary token. */
function Sparkline({ data }: { data: Array<{ date: string; amount: number }> }) {
  const width = 600;
  const height = 160;
  const pad = 8;
  const max = Math.max(1, ...data.map((d) => d.amount));
  const points = data.map((d, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * (width - pad * 2) + pad : width / 2;
    const y = height - pad - (d.amount / max) * (height - pad * 2);
    return { x, y, d };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L${points.at(-1)?.x.toFixed(1)},${height - pad} L${points[0]?.x.toFixed(1)},${height - pad} Z`;
  const total = data.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Recharge revenue over ${data.length} days, total ${money(total)}`}
        className="h-40 w-full text-primary"
      >
        <path d={area} fill="currentColor" opacity="0.12" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{data[0]?.date}</span>
        <span className="tabular font-medium text-foreground">Total {money(total)}</span>
        <span>{data.at(-1)?.date}</span>
      </div>
    </div>
  );
}
