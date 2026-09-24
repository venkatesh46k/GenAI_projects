# Dispute Resolution SOP

This Standard Operating Procedure describes how a billing dispute raised by a prepaid subscriber is handled, from registration to closure or escalation.

## What counts as a dispute

- Being charged twice for the same recharge.
- Data or voice deducted from the balance without corresponding usage.
- Charges for services the subscriber did not activate.
- Recharge debited from the payment method but balance not credited (see the recharge policy for failed recharges).
- Suspected duplicate CDRs.

## Step-by-step procedure

1. **Register.** Create the dispute with the subscriber's number, a short reason, and the amount disputed. The system assigns an ID in the format D-xxxxxx and sets the status to `open`.
2. **Verify identity.** Confirm the request is for the subscriber's own number. Do not disclose details of another number.
3. **Check the records.** Review the last transactions and the CDRs for the disputed period. Look for duplicate transactions, deductions without a matching CDR, and mismatches between plan benefits and charges.
4. **Decide.**
   - If the records confirm the error, approve a refund to the balance (see the refund policy) and mark the dispute `resolved`.
   - If the records show valid usage, explain the charge to the subscriber and mark the dispute `rejected`.
   - If the evidence is unclear, escalate.
5. **Communicate.** Tell the subscriber the outcome, the dispute ID and the timeline.

## Resolution timelines (SLA)

| Subscriber type | First response | Resolution target |
|---|---|---|
| Standard plans (PLAN_199, PLAN_99) | 24 hours | 7 working days |
| Premium plan (PLAN_599) | 4 hours | 3 working days |
| Escalated disputes | 24 hours from escalation | 10 working days |

## Escalation criteria

Escalate to a human billing specialist when any of these apply:

- The system's confidence that the dispute can be resolved automatically is below 50 percent.
- The amount disputed is more than ₹500.
- The subscriber explicitly asks for a manager, supervisor or to file a complaint.
- The same subscriber has raised three or more disputes in 30 days.
- The evidence is contradictory or missing.

On escalation the status becomes `escalated` and a ticket ID in the format TCK-xxxxxx is issued. The subscriber must be given the ticket ID and the escalated-dispute timeline of 10 working days.

## Dispute statuses

`open` → `escalated` → `resolved` or `rejected`. A rejected dispute can be re-opened once with new evidence.
