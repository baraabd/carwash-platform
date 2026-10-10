# P04-C: Cross-child interfaces for booking cancellation and reschedule

**Status: REQUESTED / producer-pending.** This applies to every row unless the row says *published*.

- This file is byte-identical in every P04-C child PR, so the children merge cleanly.
- It is the single statement of what each child provides and consumes.
- Nothing here is a Lane E publication. Each owner's contract request (CR) asks Lane E to publish it.

Base: `main@c65db708b9a7c50e5a885799330479426e863758`.

## Ownership (unchanged)

| Fact | Owner | Never decided by |
| --- | --- | --- |
| Booking lifecycle, immutable snapshots, **change requests and their history** | Booking | Scheduling, Dispatch, Billing |
| Capacity: holds and the booking's committed unit | Scheduling | Booking (it asks, never writes) |
| Assignment, offers and the task execution record (**whether work has started**) | Dispatch | Booking |
| Obligation, payments, refunds and reversals | Billing (Lane B) | Booking, Dispatch |

**Decision P04-C-D1: Dispatch is the work-progress gate.**

- Booking never infers from its own state whether a technician has left or started. Its status stays `CONFIRMED` after assignment, because `dispatch.task-progressed.v1` is still producer-pending.
- Every change therefore asks Dispatch first. Dispatch decides under the assignment row lock, in the same transaction that withdraws offers and ends a not-yet-started task. A technician step and a change therefore have exactly one winner.

**Decision P04-C-D2: the change saga is owned by Booking.** It has two definitions:

- **Cancellation:**
  - Steps: `DISPATCH_CANCEL` (the pivot), then `RELEASE_CAPACITY`, then `SETTLE_BILLING`, then `DONE`.
  - The booking becomes `CANCELLED` in the same local transaction that records the pivot's success, together with `booking.cancelled.v1`.
  - Everything after the pivot only moves forward. Each step is retried with the same idempotent request until it gets a definitive answer.
  - A step whose outcome is unknown stays retrying (UNKNOWN). It is never assumed to have succeeded.
  - If the pivot is refused (work started or completed), the request ends `REFUSED` and the booking is untouched.
- **Reschedule:**
  - Steps: `DISPATCH_REBIND`, then `REPLACE_COMMITMENT` (the pivot), then `DISPATCH_CONFIRM`, then `DONE`. The compensation is `DISPATCH_REVERT`.
  - The new slot becomes the booking's current schedule in the same local transaction that records the pivot's success, together with `booking.rescheduled.v1`.
  - If `REPLACE_COMMITMENT` is refused, or the new hold's deadline passes before the pivot, the saga runs `DISPATCH_REVERT` and ends `FAILED`. The booking keeps its original slot.
  - A rebind refusal ends the request `REFUSED`.
  - Rebind is ordered before the pivot on purpose. When Scheduling then publishes `RELEASED` for the old hold, no live job is bound to that hold any more, so the event cannot cancel the moved job.
- **Money:** a reschedule never calls Billing. The obligation, its amount and any payment in flight are untouched, so a payment that arrives during a reschedule settles the same obligation.

## C1: Scheduling (provider), additions to `scheduling.v1`

Both routes use service scope `scheduling.commitment.change` and require an `Idempotency-Key`. Both are replay-safe by booking: a retry with a new key after a lost response returns the already-applied state and changes nothing.

| Method | Path | Body | Success | Refusals |
| --- | --- | --- | --- | --- |
| POST | `/internal/v1/scheduling/bookings/:bookingId/commitment/release` | `{holdId}` | 200 `HoldV1` (state `RELEASED`) | 409 `CONFLICT/COMMITMENT_NOT_FOUND` |
| POST | `/internal/v1/scheduling/bookings/:bookingId/commitment/replace` | `{fromHoldId, toHoldId, toExpectedRevision}` | 200 `{bookingId, released: HoldV1, committed: HoldV1}` | 409 `COMMITMENT_NOT_FOUND`; 422 `HOLD_EXPIRED` / `HOLD_NOT_ACTIVE`; 412 `REVISION_CONFLICT`; 404 (other beneficiary's hold) |

- **`release`:** the committed hold becomes `RELEASED` on the wire (internal status `CANCELLED`, reason `BOOKING_CANCELLED`), and its reserved unit is freed exactly once. A hold already given back by a staff override is also a replay.
- **`replace`:** a single transaction frees the old unit (`RESCHEDULED`) and turns the new hold's held unit into a reserved one.
  - The new hold must be `HELD`, live, at `toExpectedRevision`, and belong to the same beneficiary.
  - An expired new hold answers `HOLD_EXPIRED`, and its expiry is committed.
- **Events:** each change emits `scheduling.hold-changed.v1` (*published*), once per hold.
  - A replace emits `RELEASED` for the old hold and `COMMITTED` (with the booking id) for the new one.
  - The two holds are different aggregates. Their relative order is **not** guaranteed.
- **Database:** at most one `CONFIRMED` hold per booking, enforced by a partial unique index.

## C2: Dispatch (provider), service scope `dispatch.booking.change`

All routes require an `Idempotency-Key` and are replay-safe by `changeId`.

| Method | Path | Body | Success (200) |
| --- | --- | --- | --- |
| POST | `/internal/v1/dispatch/bookings/:bookingId/cancellation` | `{changeId}` | `{bookingId, changeId, outcome:'CANCELLED'\|'NOT_OPENED', assignmentRevision:int\|null}` |
| POST | `/internal/v1/dispatch/bookings/:bookingId/rebinding` | `{changeId, holdId, zoneId, startsAt, endsAt}` | `{bookingId, changeId, outcome:'REBOUND', assignmentRevision}` |
| POST | `/internal/v1/dispatch/bookings/:bookingId/rebinding/confirm` | `{changeId}` | `{…, outcome:'CONFIRMED', assignmentRevision}` |
| POST | `/internal/v1/dispatch/bookings/:bookingId/rebinding/revert` | `{changeId}` | `{…, outcome:'REVERTED'\|'NOTHING_TO_REVERT', assignmentRevision:int\|null}` |

**Refusals.** All are 422 `BUSINESS_RULE_VIOLATION` unless noted.

| Reason | When |
| --- | --- |
| `WORK_STARTED` | The current task is `EN_ROUTE`, `ARRIVED`, `IN_SERVICE`, `DOCUMENTING` or `FINISHED`. |
| `WORK_COMPLETED` | The task is `CLOSED`. |
| `BOOKING_CANCELLED` | A rebind is requested for a cancelled job. |
| `ASSIGNMENT_NOT_OPEN` | 409, retryable by the saga. A rebind arrived before Dispatch opened the job from the `COMMITTED` event. |
| `CHANGE_MISMATCH` | 409. The same `changeId` was used with another booking or kind. |

**Effects.** Each runs in one transaction, under the assignment row lock.

- **Cancellation:**
  - Withdraws the live offer. Ends a not-started (`ACCEPTED`) task with `JOB_CANCELLED`. Sets the assignment `CANCELLED` (`BOOKING_CANCELLED`). Emits `dispatch.assignment-changed.v1`.
  - With no assignment yet, it records a tombstone. A later `COMMITTED` event for the booking then opens nothing (`NOT_OPENED`).
- **Rebind:**
  - Withdraws the live offer. Ends an `ACCEPTED` task with `JOB_RESCHEDULED`, so the technician must re-accept the new time; the UX is owner decision TI-D06.
  - Sets the assignment back to `UNASSIGNED`, moves its hold and window to the new slot, and marks the binding **unconfirmed**.
  - While a binding is unconfirmed, no offer can be made (`RESCHEDULE_PENDING`), and `RELEASED`/`EXPIRED` of the bound hold does not cancel the job.
  - The binding is confirmed by `rebinding/confirm` or by the new hold's `COMMITTED` event, whichever comes first.
- **Revert:** restores the hold and window recorded by the rebind. The binding is confirmed again, because the old hold is still committed.

Technician accept, depart and every later step re-check the assignment under the same lock, so a technician racing a change either wins first, in which case the change sees `ACCEPTED` or a started task, or is refused afterwards (`OFFER_NOT_LIVE` or `ASSIGNMENT_CANCELLED`).

## C3: Booking (provider of `booking.v1` additions; consumer of C1, C2 and Billing)

| Method | Path | Caller | Body | Success |
| --- | --- | --- | --- | --- |
| POST | `/internal/v1/booking/bookings/:bookingId/cancellation` | beneficiary (`bookings.create:self`) or staff (`operations.dispatch`) | `{expectedRevision, reason}` | 202 `BookingChangeV1` (200 on replay) |
| POST | `/internal/v1/booking/bookings/:bookingId/reschedule` | beneficiary | `{expectedRevision, holdId, holdRevision}` | 202 `BookingChangeV1` |
| GET | `/internal/v1/booking/bookings/:bookingId/changes` | beneficiary or staff | | 200 `{items: BookingChangeV1[]}` (newest first) |

**Cancellation reasons.** A customer may give `CUSTOMER_REQUEST`. Staff may give `OPERATIONS_REQUEST`, `CUSTOMER_REQUEST_BY_PHONE` or `SERVICE_UNAVAILABLE`.

`BookingChangeV1` fields:

- `changeId`, `bookingId`, `kind` (`CANCELLATION` | `RESCHEDULE`);
- `state` (`IN_PROGRESS` | `COMPLETED` | `REFUSED` | `FAILED`);
- `reason`, plus `refusal` (`WORK_STARTED` | `WORK_COMPLETED` | `HOLD_EXPIRED` | `HOLD_NOT_ACTIVE` | `HOLD_UNAVAILABLE` | `DISPATCH_NOT_READY` | null);
- `attention` (bool: retrying for longer than the alert budget);
- `requestedAt`, `completedAt`;
- `from` slot `{holdId, zoneId, startsAt, endsAt}`, and `to` slot for a reschedule;
- `settlement` (`PENDING` | `VOIDED` | `REFUND_PENDING` | `NOTHING_DUE` | null).

**Refusals before any remote step.** Each is a 409/422 in the booking error envelope.

| Reason | When |
| --- | --- |
| `BOOKING_NOT_CONFIRMED` | The booking is still in creation, or was rejected. |
| `BOOKING_CANCELLED` | The booking is already cancelled. |
| `CHANGE_IN_PROGRESS` | Another change is still running for the booking. |
| 412 `REVISION_CONFLICT` | `expectedRevision` is stale. |
| `HOLD_NOT_USABLE` | Reschedule only: the hold is not `HELD`, belongs to someone else, is in another zone, or has a different duration from the booked service. |

**Booking view additions (`BookingV1`).**

- `schedule`: the current committed slot, with `revision` (1 = the original).
- `cancellation`: `{reason, cancelledAt}` or null.
- `pendingChange`: a `BookingChangeV1` or null.
- The original `slot` is kept unchanged, as the immutable snapshot.

**Events (producer-pending), on envelope v2, routed on `booking.events`.**

- `booking.cancelled.v1`: data `{status:'CANCELLED', changeId, reason, holdId, zoneId, startsAt, endsAt, paymentMethod, total}`.
- `booking.rescheduled.v1`: data `{changeId, scheduleRevision, previous:{holdId,startsAt,endsAt}, current:{holdId,zoneId,startsAt,endsAt}}`.
- Both carry ids only. They never carry names, phones, addresses or plates.

## Billing (Lane B): requested, not implemented by Lane C

`POST /internal/v1/billing/bookings/:bookingId/cancellation-settlement`:

- service scope `billing.booking.cancel`;
- body `{changeId}`;
- requires an `Idempotency-Key`; replay-safe by booking.

Response 200 `{bookingId, outcome}`, where `outcome` is one of:

| Outcome | Meaning |
| --- | --- |
| `VOIDED` | No payment was ever reported. The obligation is voided. |
| `REFUND_PENDING` | A payment was reported or verified. Billing opened a refund or reversal case for Finance review (B-06). |
| `NOTHING_DUE` | No obligation exists. Billing records a tombstone so that a late create never resurrects it. |

Billing must refuse new payment attempts on a voided obligation, and route any money that arrives after `VOIDED` into the same refund case (**late payment after cancellation**).

Until Lane B implements this route, the saga stays at `SETTLE_BILLING` with `settlement: PENDING`, retrying with backoff and raising `attention`. That wait is never reported as settled.
