# Low Balance Barring

Barring means restricting some or all services on a prepaid number because the main balance is too low to pay for usage. It is different from expiry, which is about plan validity.

## Thresholds

| Balance | Outcome |
|---|---|
| ₹10 or more | Normal service. |
| ₹5 to below ₹10 | **Low balance warning.** An SMS alert is sent. Service is not restricted. |
| Below ₹5 | **Outgoing barring.** Outgoing calls and outgoing SMS beyond the plan bundle are blocked. Incoming calls and SMS continue. |
| ₹0 or negative | **Full barring** for out-of-bundle usage. Data outside the bundle is stopped. Incoming calls continue for 7 days. |

Usage that is covered by an active plan's bundle (data, minutes and SMS included in the plan) is not blocked by low balance alone. Barring applies to usage that would be charged from the main balance.

## Status value

When a number is barred, its account status is `barred`. A barred subscriber with a valid plan can still use bundled allowances. The status changes back to `active` once the balance is restored above the threshold.

## Incoming barring

If a number stays fully barred for 7 consecutive days, incoming calls are also blocked. If it stays blocked longer, the expiry rules for suspension and disconnection apply (see the plan validity document).

## How to remove barring

1. Recharge. A recharge that brings the balance to ₹5 or above removes outgoing barring immediately.
2. A recharge that brings the balance to ₹10 or above also clears the low balance warning state.
3. No reconnection fee is charged.

## Example

A subscriber with a balance of ₹3.50 has outgoing barring for out-of-bundle usage. After recharging ₹99, the balance becomes ₹102.50 and the number is unbarred straight away.

## Barred despite a healthy balance?

If a number appears barred even though the balance is above the threshold, or if barring persisted after a successful recharge, the subscriber should raise a billing dispute so the status can be corrected.
