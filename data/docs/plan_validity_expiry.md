# Plan Validity and Expiry

This document describes what happens when a prepaid plan reaches the end of its validity, and how service is restored.

## Validity basics

- Validity starts at the moment of a successful recharge that activates the plan.
- Basic 199 has 28 days, Data Topup 99 has 30 days, Premium 599 has 56 days.
- Validity is counted in whole days from the activation time, so a plan activated at 3 pm on day 1 ends at 3 pm on the last day.
- Recharging again with the same plan before it expires extends the validity from the current expiry date; the days are not lost.

## Expiry and grace period

When a plan expires, the subscriber enters a grace period:

| Stage | Duration after expiry | Service |
|---|---|---|
| Grace period | Days 1 to 15 | Incoming calls and SMS continue. Outgoing calls, outgoing SMS and data are blocked. |
| Suspension | Days 16 to 90 | Outgoing and incoming services are both blocked. The number is retained. |
| Disconnection | After day 90 | The number may be permanently disconnected and returned to the pool. |

## Balance after expiry

- The main talk-time balance remains on the account during the grace period and suspension.
- Unused bundled data and voice minutes of the expired plan are lost on expiry. They do not carry forward.
- If the remaining main balance is enough to cover a plan's price, the subscriber can activate a plan without adding money.

## Restoring service

1. Recharge with a plan such as PLAN_199 or PLAN_599.
2. Service is restored immediately after successful activation. The account status returns to `active`.
3. The new validity starts from the time of the new recharge, not from the earlier expiry.

## Account status values

- `active`: the plan is valid and service is normal.
- `expired`: the plan validity has ended and the grace or suspension rules apply.
- `barred`: service is restricted because the balance is below the barring threshold (see the low balance barring document).
