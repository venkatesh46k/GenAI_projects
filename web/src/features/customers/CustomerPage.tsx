import type { CustomerOverview, DisputeSummary } from "@contract/schemas";
import { ArrowLeft, Ban, MessageSquare, Phone, TriangleAlert, Wallet, Wifi } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useEscalate, useOverview, useResolveDispute, useSession } from "@/api/hooks";
import { EmptyState, ErrorState } from "@/components/states";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { RoleGatedButton } from "@/components/RoleGatedButton";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, Table, TableCell, TableHead, TableRow } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { LOW_BALANCE, LOW_BALANCE_WARNING, formatUsage, formatWhen, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recordRecentlyViewed } from "@/lib/recentlyViewed";
import { ActivityTab } from "./ActivityTab";
import { RechargeDialog } from "./RechargeDialog";
import { TagsRow } from "./TagsRow";

const DISPUTE_TONE = { open: "info", escalated: "warning", resolved: "success", rejected: "danger" } as const;
const CALL_ICON = { voice: Phone, sms: MessageSquare, data: Wifi } as const;

export function CustomerPage() {
  const { msisdn = "" } = useParams();
  const overview = useOverview(msisdn);

  if (overview.isPending) return <CustomerSkeleton />;
  if (overview.isError) {
    if (overview.error instanceof ApiError && overview.error.status === 404) {
      return (
        <div className="flex flex-col gap-4">
          <BackLink />
          <Card>
            <EmptyState
              title={`No customer with number ${msisdn}`}
              hint="Check the number, or search from the customer list."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/customers">Back to customers</Link>
                </Button>
              }
            />
          </Card>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Card>
          <ErrorState message={overview.error.message} onRetry={() => void overview.refetch()} />
        </Card>
      </div>
    );
  }
  return <CustomerView data={overview.data} />;
}

function BackLink() {
  return (
    <Link to="/customers" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Customers
    </Link>
  );
}

function CustomerView({ data }: { data: CustomerOverview }) {
  const { subscriber, plan, usage, transactions, disputes, notes, tags } = data;
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const isTeamLead = useSession().data?.role === "team_lead";
  useEffect(() => recordRecentlyViewed(subscriber.msisdn), [subscriber.msisdn]);
  const barred = subscriber.status === "barred";
  // Three tiers from the low-balance policy: barred and below-₹5 both bar out-of-bundle usage (the same message
  // covers both, since a barred number is also below ₹5); ₹5 to below ₹10 only sends a warning SMS.
  const low = !barred && subscriber.balance < LOW_BALANCE;
  const warn = !barred && !low && subscriber.balance < LOW_BALANCE_WARNING;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
            {subscriber.msisdn.slice(-2)}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="tabular text-2xl font-semibold tracking-tight" data-testid="customer-number">
                {subscriber.msisdn}
              </h1>
              <StatusBadge status={subscriber.status} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Prepaid subscriber · last recharge {formatWhen(subscriber.last_recharge_date)}
            </p>
            <div className="mt-2">
              <TagsRow msisdn={subscriber.msisdn} tags={tags} />
            </div>
          </div>
        </div>
        <Button variant="primary" onClick={() => setRechargeOpen(true)} data-testid="open-recharge">
          <Wallet /> Recharge
        </Button>
      </div>

      {(barred || low || warn) && (
        <div
          role="alert"
          data-testid="balance-alert"
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
            barred || low ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning",
          )}
        >
          {barred || low ? <Ban className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
          <p>
            {barred
              ? `This number is barred. A recharge that brings the balance to ${money(LOW_BALANCE)} or more lifts outgoing barring.`
              : low
                ? `Balance is below ${money(LOW_BALANCE)}: outgoing usage outside the plan bundle is barred.`
                : `Low balance warning: the customer has been sent an SMS alert. Service is not restricted yet; a recharge below ${money(LOW_BALANCE)} will bar outgoing usage outside the plan bundle.`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Balance" testId="kpi-balance" value={money(subscriber.balance)} tone={barred || low ? "danger" : warn ? "warning" : undefined} />
        <Kpi label="Plan" testId="kpi-plan" value={plan?.name ?? "No plan"} hint={plan ? `${plan.data_per_day_gb} GB/day · ${plan.voice_minutes} min · ${plan.sms_per_day} SMS/day` : undefined} />
        <Kpi label="Plan price" value={plan ? money(plan.price) : "-"} />
        <Kpi label="Validity" value={plan ? `${plan.validity_days} days` : "-"} />
      </div>

      <Card>
        <Tabs defaultValue="usage">
          <TabsList className="px-3">
            <TabsTrigger value="usage" data-testid="tab-usage">
              Usage <Count n={usage.length} />
            </TabsTrigger>
            <TabsTrigger value="transactions" data-testid="tab-transactions">
              Transactions <Count n={transactions.length} />
            </TabsTrigger>
            <TabsTrigger value="disputes" data-testid="tab-disputes">
              Disputes <Count n={disputes.length} />
            </TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-activity">
              Activity <Count n={notes.length} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="usage">
            {usage.length === 0 ? (
              <EmptyState title="No usage records" />
            ) : (
              <Table aria-label="Usage">
                <thead>
                  <tr>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead className="text-right">Charge</TableHead>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((record) => {
                    const Icon = CALL_ICON[record.call_type as keyof typeof CALL_ICON] ?? Phone;
                    return (
                      <TableRow key={record.cdr_id}>
                        <TableCell className="text-muted-foreground">{formatWhen(record.timestamp)}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-2 capitalize">
                            <Icon className="size-4 text-muted-foreground" aria-hidden /> {record.call_type}
                          </span>
                        </TableCell>
                        <TableCell className="tabular">{formatUsage(record)}</TableCell>
                        <TableCell className="tabular text-right">{money(record.charge)}</TableCell>
                      </TableRow>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="transactions">
            {transactions.length === 0 ? (
              <EmptyState title="No transactions yet" hint="Recharges made from this console or through the Copilot appear here." icon={<Wallet className="size-5" />} />
            ) : (
              <Table aria-label="Transactions" data-testid="transactions-table">
                <thead>
                  <tr>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance after</TableHead>
                    <TableHead>Reference</TableHead>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <TableRow key={txn.txn_id}>
                      <TableCell className="text-muted-foreground">{formatWhen(txn.timestamp)}</TableCell>
                      <TableCell className="capitalize">{txn.type}</TableCell>
                      <TableCell className="tabular text-right">{money(txn.amount)}</TableCell>
                      <TableCell className="tabular text-right">{money(txn.balance_after)}</TableCell>
                      <TableCell className="tabular text-muted-foreground">{txn.txn_id}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="disputes">
            {disputes.length === 0 ? (
              <EmptyState title="No disputes for this customer" />
            ) : (
              <DisputesTable msisdn={subscriber.msisdn} disputes={disputes} canAct={isTeamLead} />
            )}
          </TabsContent>

          <TabsContent value="activity">
            <ActivityTab msisdn={subscriber.msisdn} usage={usage} transactions={transactions} disputes={disputes} notes={notes} />
          </TabsContent>
        </Tabs>
      </Card>

      <RechargeDialog msisdn={subscriber.msisdn} currentPlanId={subscriber.plan_id} open={rechargeOpen} onOpenChange={setRechargeOpen} />
    </div>
  );
}

/** `canAct`: only a team lead may escalate or resolve/reject (the login page's own copy: "Reviews and escalates"). An
 * agent still sees the table and the reason a button is disabled, rather than the action just being invisible. */
function DisputesTable({ msisdn, disputes, canAct }: { msisdn: string; disputes: DisputeSummary[]; canAct: boolean }) {
  const escalate = useEscalate(msisdn);
  const resolve = useResolveDispute();
  const [target, setTarget] = useState<DisputeSummary | null>(null);
  const [resolving, setResolving] = useState<{ dispute: DisputeSummary; outcome: "resolved" | "rejected" } | null>(null);

  function confirmEscalate() {
    if (!target) return;
    escalate.mutate(target.dispute_id, {
      onSuccess: (result) => {
        toast.success(`Escalated ${result.dispute_id}`, { description: `Ticket ${result.ticket_id} · resolution target 10 working days` });
        setTarget(null);
      },
      onError: (error) => toast.error("Could not escalate", { description: error.message }),
    });
  }

  function confirmResolve() {
    if (!resolving) return;
    resolve.mutate(
      { disputeId: resolving.dispute.dispute_id, outcome: resolving.outcome },
      {
        onSuccess: (result) => {
          toast.success(`${result.dispute_id} marked ${result.status}`);
          setResolving(null);
        },
        onError: (error) => toast.error("Could not update the dispute", { description: error.message }),
      },
    );
  }

  return (
    <>
      <Table aria-label="Disputes" data-testid="disputes-table">
        <thead>
          <tr>
            <TableHead>Dispute</TableHead>
            <TableHead>Opened</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </tr>
        </thead>
        <tbody>
          {disputes.map((dispute) => (
            <TableRow key={dispute.dispute_id} data-testid={`dispute-row-${dispute.dispute_id}`}>
              <TableCell className="tabular font-medium">{dispute.dispute_id}</TableCell>
              <TableCell className="text-muted-foreground">{formatWhen(dispute.created_at)}</TableCell>
              <TableCell className="tabular text-right">{money(dispute.amount_disputed)}</TableCell>
              <TableCell>
                <Badge tone={DISPUTE_TONE[dispute.status as keyof typeof DISPUTE_TONE] ?? "neutral"} dot>
                  {dispute.status.charAt(0).toUpperCase() + dispute.status.slice(1)}
                </Badge>
              </TableCell>
              <TableCell className="max-w-64 truncate" title={dispute.reason}>
                {dispute.reason}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1.5">
                  {dispute.status === "open" && (
                    <RoleGatedButton canAct={canAct} onClick={() => setTarget(dispute)} testId={`escalate-${dispute.dispute_id}`}>
                      Escalate
                    </RoleGatedButton>
                  )}
                  {dispute.status === "escalated" && (
                    <>
                      <RoleGatedButton canAct={canAct} onClick={() => setResolving({ dispute, outcome: "resolved" })} testId={`resolve-${dispute.dispute_id}`}>
                        Resolve
                      </RoleGatedButton>
                      <RoleGatedButton canAct={canAct} variant="danger" onClick={() => setResolving({ dispute, outcome: "rejected" })} testId={`reject-${dispute.dispute_id}`}>
                        Reject
                      </RoleGatedButton>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>

      <Dialog open={target !== null} onOpenChange={(open) => !open && !escalate.isPending && setTarget(null)}>
        <DialogContent
          title="Escalate this dispute?"
          description={target ? `${target.dispute_id} · ${money(target.amount_disputed)}: it will be handed to a human billing specialist.` : undefined}
          data-testid="escalate-dialog"
        >
          <p className="px-5 py-4 text-sm text-muted-foreground">
            The customer gets a ticket number and a resolution target of 10 working days. This cannot be undone from here.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={escalate.isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmEscalate} disabled={escalate.isPending} data-testid="escalate-confirm">
              {escalate.isPending ? "Escalating…" : "Escalate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resolving !== null} onOpenChange={(open) => !open && !resolve.isPending && setResolving(null)}>
        <DialogContent
          title={resolving?.outcome === "resolved" ? "Mark this dispute resolved?" : "Reject this dispute?"}
          description={resolving ? `${resolving.dispute.dispute_id} · ${money(resolving.dispute.amount_disputed)}` : undefined}
          data-testid="resolve-dialog"
        >
          <p className="px-5 py-4 text-sm text-muted-foreground">
            {resolving?.outcome === "resolved"
              ? "The customer's claim is upheld and the dispute is closed in their favour."
              : "The dispute is closed without a credit to the customer."}{" "}
            This cannot be undone from here.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResolving(null)} disabled={resolve.isPending}>
              Cancel
            </Button>
            <Button variant={resolving?.outcome === "rejected" ? "danger" : "primary"} onClick={confirmResolve} disabled={resolve.isPending} data-testid="resolve-confirm">
              {resolve.isPending ? "Saving…" : resolving?.outcome === "resolved" ? "Mark resolved" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


function Kpi({ label, value, hint, tone, testId }: { label: string; value: string; hint?: string; tone?: "danger" | "warning"; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-1">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={cn("tabular text-2xl font-semibold tracking-tight", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Count({ n }: { n: number }): ReactNode {
  return <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{n}</span>;
}

function CustomerSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading customer" data-testid="customer-loading">
      <Skeleton className="h-5 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
