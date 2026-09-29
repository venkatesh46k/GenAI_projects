import { useState } from "react";
import { Link } from "react-router-dom";
import { useAudit, useAuditActions } from "@/api/hooks";
import { EmptyState, ErrorState } from "@/components/states";
import { Card, Input, Skeleton, Table, TableCell, TableHead, TableRow } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { formatWhen } from "@/lib/format";

const ACTION_LABEL: Record<string, string> = {
  recharge: "Recharge",
  tag_added: "Tag added",
  tag_removed: "Tag removed",
  dispute_escalated: "Dispute escalated",
  dispute_resolved: "Dispute resolved",
  dispute_rejected: "Dispute rejected",
  plan_created: "Plan created",
  plan_updated: "Plan updated",
};
const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;

export function AuditLogPage() {
  const [msisdn, setMsisdn] = useState("");
  const [action, setAction] = useState("");
  const actions = useAuditActions();
  const audit = useAudit(msisdn.trim(), action);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every recharge, tag change, dispute decision and plan change, who did it and when.</p>
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <Input
            placeholder="Filter by customer number…"
            aria-label="Filter by customer number"
            data-testid="audit-msisdn-filter"
            className="sm:max-w-xs"
            maxLength={10}
            value={msisdn}
            onChange={(event) => setMsisdn(event.target.value)}
          />
          {(actions.data?.length ?? 0) > 0 && (
            <Select aria-label="Filter by action" data-testid="audit-action-filter" className="sm:w-52" value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">All actions</option>
              {actions.data!.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </Select>
          )}
        </div>

        {audit.isError ? (
          <ErrorState message={audit.error.message} onRetry={() => void audit.refetch()} />
        ) : audit.isPending ? (
          <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading the audit log">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : audit.data!.length === 0 ? (
          <EmptyState title="No matching entries" hint="Try a different number or action." />
        ) : (
          <Table aria-label="Audit log" data-testid="audit-table">
            <thead>
              <tr>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Detail</TableHead>
              </tr>
            </thead>
            <tbody>
              {audit.data!.map((entry) => (
                <TableRow key={entry.id} data-testid={`audit-row-${entry.id}`}>
                  <TableCell className="text-muted-foreground">{formatWhen(entry.at)}</TableCell>
                  <TableCell>
                    {entry.actor_name}
                    <span className="ml-1.5 text-xs text-muted-foreground">{entry.actor_role === "team_lead" ? "Team lead" : "Agent"}</span>
                  </TableCell>
                  <TableCell>{actionLabel(entry.action)}</TableCell>
                  <TableCell className="tabular">
                    {entry.msisdn ? (
                      <Link to={`/customers/${entry.msisdn}`} className="hover:underline">
                        {entry.msisdn}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground" title={entry.detail ?? undefined}>
                    {entry.detail}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
