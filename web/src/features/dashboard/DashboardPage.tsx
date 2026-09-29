import { AlertTriangle, ArrowUpRight, Ban, TrendingUp, Users, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { useDashboard } from "@/api/hooks";
import { ErrorState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" });

export function DashboardPage() {
  const dashboard = useDashboard();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Today, at a glance.</p>
      </div>

      {dashboard.isError ? (
        <Card>
          <ErrorState message={dashboard.error.message} onRetry={() => void dashboard.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dashboard-kpis">
            <Kpi
              icon={Wallet}
              label="Recharges today"
              value={dashboard.data ? String(dashboard.data.today_recharge_count) : undefined}
              hint={dashboard.data ? money(dashboard.data.today_recharge_amount) : undefined}
            />
            <Kpi icon={Users} label="Customers" value={dashboard.data ? String(dashboard.data.customer_count) : undefined} />
            <Kpi
              icon={Ban}
              label="Barred"
              value={dashboard.data ? String(dashboard.data.barred_count) : undefined}
              tone={dashboard.data && dashboard.data.barred_count > 0 ? "danger" : undefined}
            />
            <Kpi label="Total balance held" value={dashboard.data ? money(dashboard.data.total_balance) : undefined} icon={TrendingUp} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card data-testid="revenue-chart">
              <CardHeader>
                <CardTitle>Recharge revenue, last 7 days</CardTitle>
              </CardHeader>
              <CardContent>{dashboard.data ? <RevenueChart data={dashboard.data.revenue_last_7_days} /> : <Skeleton className="h-40" />}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Disputes needing attention</CardTitle>
              </CardHeader>
              <CardContent>
                {dashboard.data ? (
                  <div className="flex flex-col gap-3">
                    <AttentionRow icon={AlertTriangle} label="Open" value={dashboard.data.open_disputes} tone="warning" />
                    <AttentionRow icon={ArrowUpRight} label="Escalated" value={dashboard.data.escalated_disputes} tone="danger" />
                    <Link to="/disputes" className="mt-1 inline-flex w-fit items-center gap-1 text-sm text-accent-foreground hover:underline" data-testid="dashboard-to-disputes">
                      Open the dispute workspace <ArrowUpRight className="size-3.5" />
                    </Link>
                  </div>
                ) : (
                  <Skeleton className="h-24" />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Wallet; label: string; value?: string; hint?: string; tone?: "danger" }) {
  return (
    <Card data-testid={`dashboard-kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-1">
        <CardTitle>{label}</CardTitle>
        <Icon className={cn("size-4 text-muted-foreground", tone === "danger" && "text-danger")} aria-hidden />
      </CardHeader>
      <CardContent>
        {value === undefined ? (
          <Skeleton className="mt-1 h-8 w-16" />
        ) : (
          <p className={cn("tabular text-2xl font-semibold tracking-tight", tone === "danger" && "text-danger")}>{value}</p>
        )}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function AttentionRow({ icon: Icon, label, value, tone }: { icon: typeof AlertTriangle; label: string; value: number; tone: "warning" | "danger" }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("flex size-8 items-center justify-center rounded-full", tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="tabular text-lg font-semibold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function RevenueChart({ data }: { data: Array<{ date: string; amount: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.amount));
  return (
    <div className="flex h-40 items-end gap-2" role="img" aria-label={`Recharge revenue for the last 7 days: ${data.map((d) => `${d.date} ${money(d.amount)}`).join(", ")}`}>
      {data.map((day) => (
        <div key={day.date} className="flex flex-1 flex-col items-center gap-1.5" title={`${day.date}: ${money(day.amount)}`}>
          <span className="text-[11px] tabular text-muted-foreground">{day.amount > 0 ? money(day.amount).replace(".00", "") : ""}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className={cn("w-full rounded-t-sm bg-primary/80 transition-all", day.amount === 0 && "bg-muted")}
              style={{ height: `${Math.max(4, (day.amount / max) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">{WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))}</span>
        </div>
      ))}
    </div>
  );
}
