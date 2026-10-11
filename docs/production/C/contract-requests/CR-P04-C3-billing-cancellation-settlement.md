# CR-P04-C3 (Billing): cancellation settlement for a cancelled booking

**To:** Lane B (Billing owner), through Lane E for the contract.
**From:** Lane C, P04-C3 (the consumer is implemented and tested against a double of this shape).
**Status:** BLOCKING the `SETTLE_BILLING` step of real cancellations. Booking-side behaviour while it is missing is defined below; it fails safe.

## Route

`POST /internal/v1/billing/bookings/:bookingId/cancellation-settlement`

| Property | Value |
| --- | --- |
| Access | service scope `billing.booking.cancel`, granted to the `booking` workload |
| Idempotency | `Idempotency-Key` required (Booking sends `booking-change-settle-<changeId>`); replay-safe **by booking** |
| Body | `{changeId: uuid}`, closed |
| Response | 200 `{bookingId, outcome}` |

`outcome` is one of:

| Outcome | When | Billing effect |
| --- | --- | --- |
| `VOIDED` | No payment attempt was ever reported for the booking's obligation. | Void it (the existing `planVoid` rule). |
| `REFUND_PENDING` | A payment was reported, or verified, or a cash receipt exists. | Open a refund or reversal case for Finance review (B-06). The obligation is never silently voided. |
| `NOTHING_DUE` | No obligation exists for the booking. | Record a tombstone so a late obligation create for this booking is refused. |

## Required Billing behaviour (late payment after cancellation)

1. Once settled, new payment attempts on the obligation are refused. This is already true for `VOIDED`: `assertOpen` raises `OBLIGATION_VOIDED`.
2. Money that arrives anyway (a wallet transfer made before the customer saw the cancellation) joins the refund case. It is never matched to the cancelled booking as "paid".
3. A repeated call returns the first outcome, even if a payment arrived in between. The refund case then absorbs the new money (rule 2).

## Booking-side behaviour until this route exists

- The call answers 404 or `NOT_CONFIGURED`. The saga treats that as UNKNOWN, never as settled.
- The cancellation stays at `SETTLE_BILLING` with `settlement: PENDING`, retries with capped backoff, and raises `attention` after 8 attempts.
- The booking itself is already `CANCELLED`, and the capacity was already released.
- Lane C proves this in `change.pg.spec.ts` and `booking-change-restart.test.mjs`.

## Not requested

A reschedule never calls Billing. The obligation and any payment in flight stay valid for the moved booking.
