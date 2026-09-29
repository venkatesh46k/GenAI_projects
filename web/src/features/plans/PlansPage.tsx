import type { PlanResponse } from "@contract/schemas";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { useCreatePlan, usePlans, useSession, useUpdatePlan } from "@/api/hooks";
import { ApiError } from "@/lib/api";
import { RoleGatedButton } from "@/components/RoleGatedButton";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlays";
import { Card, Input, Label, Skeleton, Table, TableCell, TableHead, TableRow } from "@/components/ui/primitives";
import { money } from "@/lib/format";

type Draft = { plan_id: string; name: string; price: string; validity_days: string; data_per_day_gb: string; voice_minutes: string; sms_per_day: string };
const BLANK: Draft = { plan_id: "", name: "", price: "", validity_days: "", data_per_day_gb: "", voice_minutes: "", sms_per_day: "" };
const fromPlan = (p: PlanResponse): Draft => ({
  plan_id: p.plan_id,
  name: p.name,
  price: String(p.price),
  validity_days: String(p.validity_days),
  data_per_day_gb: String(p.data_per_day_gb),
  voice_minutes: String(p.voice_minutes),
  sms_per_day: String(p.sms_per_day),
});

export function PlansPage() {
  const plans = usePlans();
  const isTeamLead = useSession().data?.role === "team_lead";
  const [editing, setEditing] = useState<Draft | null>(null); // null closed; BLANK for "new"; fromPlan(p) for "edit"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">The plan catalog every recharge and report draws from.</p>
        </div>
        <RoleGatedButton canAct={isTeamLead} onClick={() => setEditing(BLANK)} testId="new-plan">
          <Plus /> New plan
        </RoleGatedButton>
      </div>

      <Card>
        {plans.isError ? (
          <ErrorState message={plans.error.message} onRetry={() => void plans.refetch()} />
        ) : plans.isPending ? (
          <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading plans">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Table aria-label="Plans" data-testid="plans-table">
            <thead>
              <tr>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Validity</TableHead>
                <TableHead className="text-right">Data/day</TableHead>
                <TableHead className="text-right">Voice</TableHead>
                <TableHead className="text-right">SMS/day</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </tr>
            </thead>
            <tbody>
              {plans.data!.map((plan) => (
                <TableRow key={plan.plan_id} data-testid={`plan-row-${plan.plan_id}`}>
                  <TableCell>
                    <span className="font-medium">{plan.name}</span>
                    <span className="tabular ml-1.5 text-xs text-muted-foreground">{plan.plan_id}</span>
                  </TableCell>
                  <TableCell className="tabular text-right">{money(plan.price)}</TableCell>
                  <TableCell className="tabular text-right">{plan.validity_days} days</TableCell>
                  <TableCell className="tabular text-right">{plan.data_per_day_gb} GB</TableCell>
                  <TableCell className="tabular text-right">{plan.voice_minutes} min</TableCell>
                  <TableCell className="tabular text-right">{plan.sms_per_day}</TableCell>
                  <TableCell className="text-right">
                    <RoleGatedButton canAct={isTeamLead} onClick={() => setEditing(fromPlan(plan))} testId={`edit-plan-${plan.plan_id}`}>
                      <Pencil /> Edit
                    </RoleGatedButton>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <PlanDialog draft={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </div>
  );
}

function PlanDialog({ draft, onOpenChange }: { draft: Draft | null; onOpenChange: (open: boolean) => void }) {
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const [form, setForm] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  // "New plan" always opens with an empty id; editing a plan always opens with its real one, so `draft` alone
  // says which mode this is, no separate lookup needed.
  const isNew = draft?.plan_id === "";

  // A fresh draft (a different plan, or a blank "new" one) arrives as a new object each time the dialog opens;
  // resync the form to it rather than keep whatever was left over from the last time it was open.
  useEffect(() => {
    if (draft) {
      setForm(draft);
      setError(null);
    }
  }, [draft]);

  function set<K extends keyof Draft>(key: K) {
    return (event: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: event.target.value }));
  }

  /** The typed body if the form is valid; otherwise sets the error message and returns null. */
  function parseBody(): Omit<PlanResponse, "plan_id"> | null {
    const price = Number(form.price);
    const validity_days = Number(form.validity_days);
    const data_per_day_gb = Number(form.data_per_day_gb);
    const voice_minutes = Number(form.voice_minutes);
    const sms_per_day = Number(form.sms_per_day);

    let problem: string | null = null;
    if (!form.name.trim()) problem = "Enter a plan name.";
    else if (!(price > 0)) problem = "Price must be greater than zero.";
    else if (!(validity_days > 0) || !Number.isInteger(validity_days)) problem = "Validity must be a whole number of days.";
    else if (data_per_day_gb < 0 || voice_minutes < 0 || sms_per_day < 0) problem = "Data, voice and SMS cannot be negative.";

    setError(problem);
    if (problem) return null;
    return { name: form.name.trim(), price, validity_days, data_per_day_gb, voice_minutes, sms_per_day };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = parseBody();
    if (!body) return;
    if (isNew) {
      if (!/^[A-Z0-9_]{2,20}$/.test(form.plan_id)) return setError("Plan id: uppercase letters, digits and underscores, e.g. PLAN_249.");
      create.mutate(
        { plan_id: form.plan_id, ...body },
        {
          onSuccess: () => {
            toast.success(`${form.plan_id} created`);
            onOpenChange(false);
          },
          onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create the plan."),
        },
      );
    } else {
      update.mutate(
        { plan_id: form.plan_id, ...body },
        {
          onSuccess: () => {
            toast.success(`${form.plan_id} updated`);
            onOpenChange(false);
          },
          onError: (err) => setError(err instanceof ApiError ? err.message : "Could not update the plan."),
        },
      );
    }
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && !pending && onOpenChange(false)}>
      {draft && (
        <DialogContent title={isNew ? "New plan" : `Edit ${draft.plan_id}`} data-testid="plan-dialog">
          <form onSubmit={submit} className="flex flex-col" noValidate>
            <div className="grid grid-cols-2 gap-4 px-5 py-5">
              {isNew && (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor="plan_id">Plan id</Label>
                  <Input id="plan_id" data-testid="plan-id-input" placeholder="PLAN_249" value={form.plan_id} onChange={set("plan_id")} autoFocus />
                </div>
              )}
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" data-testid="plan-name-input" value={form.name} onChange={set("name")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="price">Price (₹)</Label>
                <Input id="price" data-testid="plan-price-input" inputMode="decimal" value={form.price} onChange={set("price")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="validity_days">Validity (days)</Label>
                <Input id="validity_days" inputMode="numeric" value={form.validity_days} onChange={set("validity_days")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="data_per_day_gb">Data/day (GB)</Label>
                <Input id="data_per_day_gb" inputMode="decimal" value={form.data_per_day_gb} onChange={set("data_per_day_gb")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="voice_minutes">Voice minutes</Label>
                <Input id="voice_minutes" inputMode="numeric" value={form.voice_minutes} onChange={set("voice_minutes")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sms_per_day">SMS/day</Label>
                <Input id="sms_per_day" inputMode="numeric" value={form.sms_per_day} onChange={set("sms_per_day")} />
              </div>
            </div>
            {error && (
              <p role="alert" data-testid="plan-form-error" className="mx-5 mb-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending} data-testid="plan-save">
                {pending ? "Saving…" : isNew ? "Create plan" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
