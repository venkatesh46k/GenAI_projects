import type { DisputeSummary } from "@contract/schemas";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useDisputes, useEscalate, useResolveDispute, useSession } from "@/api/hooks";
import { RoleGatedButton } from "@/components/RoleGatedButton";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlays";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, Table, TableCell, TableHead, TableRow } from "@/components/ui/primitives";
import { formatWhen, money } from "@/lib/format";
import { cn } from "@/lib/utils";

const DISPUTE_TONE = { open: "info", escalated: "warning", resolved: "success", rejected: "danger" } as const;
const RESOLUTION_TARGET_DAYS = 10; // the SOP: a first response within 24 hours, resolution within 10 working days

const STATUSES = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
] as const;

/** How many calendar days remain of the 10-working-day SLA. A rough approximation (no business-day calendar in the
 * demo data), which is why it is framed as "about" in the UI. */
function daysRemaining(createdAt: string): number {
  const elapsed = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  return Math.ceil(RESOLUTION_TARGET_DAYS - elapsed);
}

function Sla({ createdAt, status }: { createdAt: string; status: string }) {
  if (status === "resolved" || status === "rejected") return <span className="text-xs text-muted-foreground">Closed</span>;
  const left = daysRemaining(createdAt);
  const overdue = left < 0;
  return (
    <span className={cn("text-xs tabular", overdue ? "font-medium text-danger" : left <= 2 ? "font-medium text-warning" : "text-muted-foreground")}>
      {overdue ? `Overdue by ${Math.abs(left)}d` : `~${left}d left`}
    </span>
  );
}

export function DisputeWorkspacePage() {
  const [status, setStatus] = useState("");
  const disputes = useDisputes(status);
  const isTeamLead = useSession().data?.role === "team_lead";
  const escalate = useEscalate(""); // the workspace spans customers; onSuccess invalidates ["disputes"], not one overview
  const resolve = useResolveDispute();
  const [escalating, setEscalating] = useState<DisputeSummary | null>(null);
  const [resolving, setResolving] = useState<{ dispute: DisputeSummary; outcome: "resolved" | "rejected" } | null>(null);

  function confirmEscalate() {
    if (!escalating) return;
    escalate.mutate(escalating.dispute_id, {
      onSuccess: (result) => {
        toast.success(`Escalated ${result.dispute_id}`, { description: `Ticket ${result.ticket_id}` });
        setEscalating(null);
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

  const rows = disputes.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Disputes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every dispute across every customer, oldest first within each status.</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border pb-4">
          <CardTitle className="sr-only">Filter</CardTitle>
          <div role="radiogroup" aria-label="Filter by status" className="inline-flex rounded-md border border-border bg-muted p-0.5">
            {STATUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={status === option.value}
                data-testid={`dispute-status-filter-${option.value || "all"}`}
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
        </CardHeader>

        <CardContent className="p-0">
          {disputes.isError ? (
            <ErrorState message={disputes.error.message} onRetry={() => void disputes.refetch()} />
          ) : disputes.isPending ? (
            <div className="flex flex-col gap-3 p-4" data-testid="disputes-loading" aria-busy="true" aria-label="Loading disputes">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title="No disputes here" hint="Nothing matches this filter." />
          ) : (
            <Table aria-label="Disputes" data-testid="disputes-workspace-table">
              <thead>
                <tr>
                  <TableHead>Dispute</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </tr>
              </thead>
              <tbody>
                {rows.map((dispute) => (
                  <TableRow key={dispute.dispute_id} data-testid={`workspace-dispute-${dispute.dispute_id}`}>
                    <TableCell className="tabular font-medium">{dispute.dispute_id}</TableCell>
                    <TableCell>
                      <Link to={`/customers/${dispute.msisdn}`} className="tabular hover:underline">
                        {dispute.msisdn}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatWhen(dispute.created_at)}</TableCell>
                    <TableCell className="tabular text-right">{money(dispute.amount_disputed)}</TableCell>
                    <TableCell>
                      <Badge tone={DISPUTE_TONE[dispute.status as keyof typeof DISPUTE_TONE] ?? "neutral"} dot>
                        {dispute.status.charAt(0).toUpperCase() + dispute.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Sla createdAt={dispute.created_at} status={dispute.status} />
                    </TableCell>
                    <TableCell className="max-w-64 truncate" title={dispute.reason}>
                      {dispute.reason}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {dispute.status === "open" && (
                          <RoleGatedButton canAct={isTeamLead} onClick={() => setEscalating(dispute)} testId={`workspace-escalate-${dispute.dispute_id}`}>
                            Escalate
                          </RoleGatedButton>
                        )}
                        {dispute.status === "escalated" && (
                          <>
                            <RoleGatedButton canAct={isTeamLead} onClick={() => setResolving({ dispute, outcome: "resolved" })} testId={`workspace-resolve-${dispute.dispute_id}`}>
                              Resolve
                            </RoleGatedButton>
                            <RoleGatedButton canAct={isTeamLead} variant="danger" onClick={() => setResolving({ dispute, outcome: "rejected" })} testId={`workspace-reject-${dispute.dispute_id}`}>
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
          )}
        </CardContent>
      </Card>

      <Dialog open={escalating !== null} onOpenChange={(open) => !open && !escalate.isPending && setEscalating(null)}>
        <DialogContent
          title="Escalate this dispute?"
          description={escalating ? `${escalating.dispute_id} · ${escalating.msisdn} · ${money(escalating.amount_disputed)}` : undefined}
          data-testid="workspace-escalate-dialog"
        >
          <p className="px-5 py-4 text-sm text-muted-foreground">It will be handed to a human billing specialist. This cannot be undone from here.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEscalating(null)} disabled={escalate.isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmEscalate} disabled={escalate.isPending} data-testid="workspace-escalate-confirm">
              {escalate.isPending ? "Escalating…" : "Escalate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resolving !== null} onOpenChange={(open) => !open && !resolve.isPending && setResolving(null)}>
        <DialogContent
          title={resolving?.outcome === "resolved" ? "Mark this dispute resolved?" : "Reject this dispute?"}
          description={resolving ? `${resolving.dispute.dispute_id} · ${resolving.dispute.msisdn} · ${money(resolving.dispute.amount_disputed)}` : undefined}
          data-testid="workspace-resolve-dialog"
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
            <Button variant={resolving?.outcome === "rejected" ? "danger" : "primary"} onClick={confirmResolve} disabled={resolve.isPending} data-testid="workspace-resolve-confirm">
              {resolve.isPending ? "Saving…" : resolving?.outcome === "resolved" ? "Mark resolved" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
