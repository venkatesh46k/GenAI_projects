import type { RechargeResponse } from "@contract/schemas";
import { CheckCircle2, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { usePlans, useRecharge } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/overlays";
import { Input, Label } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { formatWhen, money } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRESETS = [99, 199, 599];
const MAX_AMOUNT = 100_000;

/** The amount as a number, or the reason it is not acceptable. Pure, so it can be tested on its own. */
export function parseAmount(raw: string): { value: number; error: null } | { value: null; error: string } {
  const text = raw.trim();
  if (!text) return { value: null, error: "Enter an amount." };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { value: null, error: "Use digits with at most 2 decimals, for example 199 or 99.50." };
  const value = Number(text);
  if (value <= 0) return { value: null, error: "The amount must be greater than zero." };
  if (value > MAX_AMOUNT) return { value: null, error: `The amount cannot exceed ${money(MAX_AMOUNT)}.` };
  return { value, error: null };
}

interface Props {
  msisdn: string;
  currentPlanId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "details" | "review" | "receipt";

export function RechargeDialog({ msisdn, currentPlanId, open, onOpenChange }: Props) {
  const plans = usePlans();
  const recharge = useRecharge(msisdn);
  const [step, setStep] = useState<Step>("details");
  const [amountText, setAmountText] = useState("");
  const [planId, setPlanId] = useState("");
  const [touched, setTouched] = useState(false);
  const [receipt, setReceipt] = useState<{ result: RechargeResponse; at: string; amount: number } | null>(null);

  // Every time the dialog is closed it starts from a clean first step next time.
  useEffect(() => {
    if (open) return;
    setStep("details");
    setAmountText("");
    setPlanId("");
    setTouched(false);
    setReceipt(null);
    recharge.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the open flag should trigger a reset
  }, [open]);

  const parsed = parseAmount(amountText);
  const amountError = touched ? parsed.error : null;
  const selectedPlan = plans.data?.find((plan) => plan.plan_id === planId);
  const planLabel = selectedPlan ? `${selectedPlan.name} (${selectedPlan.plan_id})` : currentPlanId ? `Keep current plan (${currentPlanId})` : "No plan change";

  function continueToReview() {
    setTouched(true);
    if (parsed.error === null) setStep("review");
  }

  function confirm() {
    if (parsed.error !== null) return;
    const amount = parsed.value;
    recharge.mutate(
      { amount, plan_id: planId || null },
      {
        onSuccess: (result) => {
          setReceipt({ result, at: new Date().toISOString(), amount });
          setStep("receipt");
        },
      },
    );
  }

  async function copyReference(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Transaction ID copied");
    } catch {
      toast.error("Could not copy. Select the text instead.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={step === "receipt" ? "Recharge successful" : "Recharge"}
        description={step === "receipt" ? undefined : `Add balance to ${msisdn}`}
        data-testid="recharge-dialog"
        onInteractOutside={(event) => {
          if (recharge.isPending) event.preventDefault(); // never lose track of a charge that is in flight
        }}
      >
        <Progress step={step} />

        {step === "details" && (
          <form
            className="flex flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              continueToReview();
            }}
            noValidate
          >
            <div className="flex flex-col gap-5 px-5 py-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="recharge-amount">Amount (₹)</Label>
                <Input
                  id="recharge-amount"
                  data-testid="recharge-amount"
                  inputMode="decimal"
                  autoFocus
                  autoComplete="off"
                  placeholder="0.00"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  onBlur={() => amountText && setTouched(true)}
                  aria-invalid={amountError ? true : undefined}
                  aria-describedby={amountError ? "recharge-amount-error" : undefined}
                />
                <div className="flex gap-2" role="group" aria-label="Quick amounts">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      data-testid={`preset-${preset}`}
                      onClick={() => {
                        setAmountText(String(preset));
                        setTouched(true);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm transition-colors",
                        amountText === String(preset) ? "border-primary bg-accent text-accent-foreground" : "border-input hover:border-muted-foreground/50",
                      )}
                    >
                      {money(preset)}
                    </button>
                  ))}
                </div>
                {amountError && (
                  <p id="recharge-amount-error" role="alert" className="text-xs text-danger">
                    {amountError}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="recharge-plan">Plan</Label>
                <Select id="recharge-plan" data-testid="recharge-plan" value={planId} onChange={(event) => setPlanId(event.target.value)} disabled={plans.isPending}>
                  <option value="">{currentPlanId ? `Keep current plan (${currentPlanId})` : "No plan change"}</option>
                  {plans.data?.map((plan) => (
                    <option key={plan.plan_id} value={plan.plan_id}>
                      {plan.name} · {money(plan.price)} · {plan.validity_days} days
                    </option>
                  ))}
                </Select>
                {plans.isError && <p className="text-xs text-danger">Could not load plans. The current plan will be kept.</p>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="primary" type="submit" data-testid="recharge-continue">
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "review" && parsed.error === null && (
          <div className="flex flex-col" data-testid="recharge-review">
            <dl className="flex flex-col divide-y divide-border px-5 py-2 text-sm">
              <Row label="Customer" value={<span className="tabular">{msisdn}</span>} />
              <Row label="Amount" value={<span className="tabular font-medium" data-testid="review-amount">{money(parsed.value)}</span>} />
              <Row label="Plan" value={planLabel} />
            </dl>
            {recharge.isError && (
              <p role="alert" data-testid="recharge-error" className="mx-5 mb-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {recharge.error.message}
              </p>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setStep("details")} disabled={recharge.isPending} data-testid="recharge-back">
                Back
              </Button>
              <Button variant="primary" onClick={confirm} disabled={recharge.isPending} data-testid="recharge-confirm">
                {recharge.isPending ? "Charging…" : "Confirm recharge"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "receipt" && receipt && (
          <div className="flex flex-col" data-testid="recharge-receipt">
            <div className="flex flex-col items-center gap-2 px-5 pt-6 text-center">
              <CheckCircle2 className="size-10 text-success" aria-hidden />
              <p className="text-sm text-muted-foreground">{money(receipt.amount)} added to {msisdn}</p>
            </div>
            <dl className="flex flex-col divide-y divide-border px-5 py-3 text-sm">
              <Row
                label="Transaction ID"
                value={
                  <span className="flex items-center gap-1.5">
                    <span className="tabular" data-testid="receipt-txn">{receipt.result.txn_id}</span>
                    <button
                      type="button"
                      aria-label="Copy transaction ID"
                      onClick={() => void copyReference(receipt.result.txn_id)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </span>
                }
              />
              <Row label="New balance" value={<span className="tabular font-semibold" data-testid="receipt-balance">{money(receipt.result.new_balance)}</span>} />
              <Row label="Time" value={formatWhen(receipt.at)} />
            </dl>
            <DialogFooter>
              <Button variant="primary" onClick={() => onOpenChange(false)} data-testid="recharge-done">
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "details", label: "Details" },
  { id: "review", label: "Review" },
  { id: "receipt", label: "Receipt" },
];

function Progress({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex items-center gap-2 border-b border-border px-5 py-3 text-xs" aria-label="Progress">
      {STEPS.map((s, index) => (
        <li key={s.id} aria-current={index === current ? "step" : undefined} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
              index <= current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {index + 1}
          </span>
          <span className={index === current ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
          {index < STEPS.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
