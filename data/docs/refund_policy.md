# Refund Policy

This policy explains when a prepaid subscriber is entitled to a refund, how long it takes, and how the money is returned.

## When refunds are issued

A refund is issued when a billing dispute is verified and one of these is confirmed:

- **Duplicate recharge:** the same recharge was debited twice.
- **Recharge not credited:** money was debited from the payment source but the balance and plan benefit were never applied.
- **Deduction without usage:** balance was deducted with no matching CDR or with a duplicate CDR.
- **Wrong rating:** usage covered by the plan bundle was charged from the balance.
- **Service not delivered:** a plan was activated but its benefits were not provided because of a network-side fault.

## When refunds are not issued

- Voluntary change of mind after a plan is activated.
- Unused data or minutes at the end of validity.
- Usage that was correctly rated under the published tariff.
- Data top-up packs after activation, unless activation failed.

## Refund methods

| Case | Method |
|---|---|
| Wrong deduction from balance | Credited back to the main balance immediately after approval. |
| Money debited but not credited | Reversed to the original payment source. |
| Balance credit not wanted (on request) | Returned to the original payment source, subject to verification. |

## Timelines

- **Credit to the main balance:** on approval of the dispute, usually within the same day.
- **Refund to the payment source:** within 7 working days after approval. The time taken by the bank or wallet after that is outside the operator's control.
- The dispute itself follows the resolution timelines in the dispute resolution SOP.

## Refund amounts

The refund equals the amount verified as wrongly charged. It is never more than the amount disputed. If only part of the disputed amount is found to be wrong, only that part is refunded and the rest is rejected with an explanation.

## Transaction record

A refund is recorded as a transaction of type `refund` with its own transaction ID, the amount and the balance after the refund.
