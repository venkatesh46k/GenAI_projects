import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCustomers } from "@/api/hooks";
import { EmptyState, ErrorState } from "@/components/states";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Input, Skeleton, Table, TableCell, TableHead, TableRow } from "@/components/ui/primitives";
import { formatWhen, money } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUSES = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "barred", label: "Barred" },
  { value: "expired", label: "Expired" },
] as const;

/** Value that follows `value` after it has stopped changing for `ms`: one request per pause, not per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const [text, setText] = useState(urlQuery);
  const debounced = useDebounced(text.trim(), 250);
  const navigate = useNavigate();

  // Keep the address bar in step with the filters, so a search can be shared and Back works.
  useEffect(() => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (debounced) next.set("q", debounced);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [debounced, setParams]);

  const customers = useCustomers(debounced, status);
  const rows = useMemo(() => customers.data ?? [], [customers.data]);
  const totals = useMemo(
    () => ({
      count: rows.length,
      active: rows.filter((c) => c.status === "active").length,
      barred: rows.filter((c) => c.status === "barred").length,
      balance: rows.reduce((sum, c) => sum + c.balance, 0),
    }),
    [rows],
  );

  const setStatus = (value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set("status", value);
      else next.delete("status");
      return next;
    });

  const filtered = Boolean(debounced || status);
  const clearFilters = () => {
    setText("");
    setParams({}, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="mt-1 text-sm text-muted-foreground">Look up a prepaid subscriber to see their balance, usage and disputes.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="customer-stats">
        <Stat label={filtered ? "Matching" : "Customers"} value={String(totals.count)} loading={customers.isPending} />
        <Stat label="Active" value={String(totals.active)} loading={customers.isPending} />
        <Stat label="Barred" value={String(totals.barred)} loading={customers.isPending} tone={totals.barred ? "danger" : undefined} />
        <Stat label="Total balance" value={money(totals.balance)} loading={customers.isPending} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              inputMode="numeric"
              placeholder="Search by number…"
              aria-label="Search customers by number"
              data-testid="customers-search"
              className="pl-9 pr-9"
              maxLength={20}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {text && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div role="radiogroup" aria-label="Filter by status" className="inline-flex rounded-md border border-border bg-muted p-0.5">
            {STATUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={status === option.value}
                data-testid={`status-filter-${option.value || "all"}`}
                onClick={() => setStatus(option.value)}
                className={cn(
                  "rounded-[5px] px-3 py-1 text-sm font-medium transition-colors",
                  status === option.value ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {customers.isError && !customers.data ? (
          <ErrorState message={customers.error.message} onRetry={() => void customers.refetch()} />
        ) : customers.isPending ? (
          <div className="flex flex-col gap-3 p-4" data-testid="customers-loading" aria-busy="true" aria-label="Loading customers">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No customers match" : "No customers yet"}
            hint={filtered ? "Try a different number or clear the filters." : undefined}
            action={
              filtered ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table data-testid="customers-table" aria-label="Customers">
            <thead>
              <tr>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Last recharge</TableHead>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <TableRow
                  key={customer.msisdn}
                  data-testid={`customer-row-${customer.msisdn}`}
                  className="cursor-pointer hover:bg-muted/60"
                  onClick={() => navigate(`/customers/${customer.msisdn}`)}
                >
                  <TableCell>
                    {/* The link is the keyboard and screen-reader target; clicking anywhere on the row does the same. */}
                    <Link
                      to={`/customers/${customer.msisdn}`}
                      className="tabular font-medium hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {customer.msisdn}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={customer.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{customer.plan_id ?? "No plan"}</TableCell>
                  <TableCell className={cn("tabular text-right font-medium", customer.balance < 5 && "text-danger")}>{money(customer.balance)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatWhen(customer.last_recharge_date)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, loading, tone }: { label: string; value: string; loading: boolean; tone?: "danger" }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>{loading ? <Skeleton className="mt-1 h-7 w-16" /> : <p className={cn("tabular text-2xl font-semibold", tone === "danger" && "text-danger")}>{value}</p>}</CardContent>
    </Card>
  );
}
