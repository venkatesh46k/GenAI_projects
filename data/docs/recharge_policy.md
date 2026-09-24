# Recharge Policy

This document explains how a prepaid recharge is applied to a subscriber's account and what to do when a recharge fails.

## How a recharge is applied

1. The subscriber chooses an amount and, optionally, a plan (for example PLAN_199, PLAN_599 or PLAN_99).
2. On success the recharge amount is added to the main balance and a transaction is recorded with a transaction ID in the format TXN-xxxxxxxx, the amount, the balance after recharge and a timestamp.
3. If a plan was selected, its benefits are activated and validity starts from the recharge time. The last recharge date on the account is updated.
4. The subscriber sees the new balance immediately. The balance lookup always reflects the latest recharge.

## Recharge amounts and plan selection

- The recharge amount must be greater than zero.
- Recharging with exactly the plan price activates that plan. Recharging with a different amount simply adds talk-time to the balance.
- If the subscriber's balance is at least the plan price, the plan is charged from the balance when it is activated.

## Partial recharge

A recharge smaller than the plan price does not activate the plan. The amount is added to the balance as regular talk-time, and the plan can be activated later once the balance covers its price. No penalty applies.

## Recharging a number that does not exist

A recharge is only accepted for a number that already exists in the billing system. A number that is not found is rejected with a "subscriber not found" response and no money is taken.

## Failed recharge handling

- **Payment failed and money not debited:** nothing to do. The subscriber can retry.
- **Money debited but balance not credited:** the transaction is treated as pending. If it is not credited automatically, the amount is reversed to the source of payment within 7 working days. The subscriber can also raise a billing dispute for faster review.
- **Duplicate recharge:** if the subscriber was charged twice for the same recharge, the second amount is refunded to the balance after the dispute is verified (see the refund policy).

## Barred and expired numbers

A recharge on a barred or expired number is accepted and credited, but service is restored only if the balance meets the thresholds described in the low balance barring and plan validity documents.
