# P04-C3: Booking cancellation and reschedule saga

Parent: **P04-C** (Lane C). Parent status: **INTEGRATION_PENDING**.

- Shared spec: [`P04-C-interfaces.md`](P04-C-interfaces.md), §C3 and §Billing.
- Contract requests:
  - [`CR-P04-C3-booking-changes.md`](contract-requests/CR-P04-C3-booking-changes.md), to Lane E;
  - [`CR-P04-C3-billing-cancellation-settlement.md`](contract-requests/CR-P04-C3-billing-cancellation-settlement.md), to Lane B through Lane E.

## Allowed transitions and refusals

| Booking state | Cancellation | Reschedule |
| --- | --- | --- |
| `PENDING_CONFIRMATION` (creation saga running), `REJECTED` | refused `BOOKING_NOT_CONFIRMED` | same |
| `CONFIRMED`, technician not left (Dispatch: no task, or `ACCEPTED`) | **allowed** | **allowed** |
| `CONFIRMED`, technician left or working (`EN_ROUTE` … `FINISHED`) | Dispatch refuses → change `REFUSED`/`WORK_STARTED` | same |
| `CONFIRMED`, job closed | Dispatch refuses → `REFUSED`/`WORK_COMPLETED` | same |
| `CANCELLED` | refused `BOOKING_CANCELLED` | same |
| any, while another change is open | refused `CHANGE_IN_PROGRESS` (one open change per booking, enforced by a partial unique index) | same |

**Work progress is Dispatch's answer, never Booking's guess (decision P04-C-D1).** Booking cannot see the technician leave, because `dispatch.task-progressed.v1` is still producer-pending, so its booking status stays `CONFIRMED` after assignment. Dispatch decides under its row locks, in the same transaction as its effects.

**Who may request a change:**

- The customer may cancel or reschedule their **own** booking. The cancellation reason is `CUSTOMER_REQUEST`.
- Operations staff (`operations.dispatch`) may cancel any booking, with a staff reason: `OPERATIONS_REQUEST`, `CUSTOMER_REQUEST_BY_PHONE` or `SERVICE_UNAVAILABLE`.
- Staff reschedule is not offered: there is no approved screen for it and no hold of their own to use.
- Another customer's booking is reported as not found.

**Cancellation fee or cutoff:** none (owner decision **P04-C-OD1**, open). The work-progress gate is the only rule. A fee would be a Billing decision applied at settlement.

## Saga (decision P04-C-D2)

Cancellation runs `DISPATCH_CANCEL`, then `RELEASE_CAPACITY`, then `SETTLE_BILLING`, then `DONE`.

- **`DISPATCH_CANCEL` is the pivot.** `REFUSED` ends the change with the booking untouched.
- `CANCELLED` and `NOT_OPENED` (the tombstone case) both make the booking `CANCELLED`. In **one** local transaction the saga writes:
  - the booking row;
  - `booking.cancelled.v1` into the outbox;
  - the audit row;
  - the change step.
- Every later step only moves forward and is retried until it gets a definitive answer.

Reschedule runs `DISPATCH_REBIND`, then `REPLACE_COMMITMENT` (the pivot), then `DISPATCH_CONFIRM`, then `DONE`. The compensation is `DISPATCH_REVERT`.

- **Before the pivot**, the new hold's `expiresAt` is the deadline. If Dispatch is not ready (`ASSIGNMENT_NOT_OPEN`) or its answer is unknown past that deadline, the saga reverts. The revert is replay-safe and leaves a tombstone when nothing had been rebound. The change then ends `FAILED`.
- **At the pivot**, `pivotAttempted` is stored **before** the request leaves. From then on there is no deadline: the replace is replayed by booking until Scheduling answers.
  - `REPLACED` records the new schedule, `booking_schedule` revision N+1, and `booking.rescheduled.v1`, atomically.
  - `REFUSED` (`HOLD_EXPIRED`, `HOLD_NOT_ACTIVE`, `HOLD_UNAVAILABLE`) leads to `DISPATCH_REVERT` and the change ends `FAILED`. The booking keeps its slot.

**Unknown outcomes.** A timeout, 5xx, an unparseable body or an open circuit is **UNKNOWN**:

- It is retried with the same change id. Every owner command is replay-safe by it.
- Backoff is exponential with full jitter and capped at 5 minutes.
- After 8 attempts of one step, `attention` is set for operations.
- An unknown outcome is never reported as success.

## Snapshots and history

- **The original snapshots never change.** That covers `slot`, the vehicle, address, contact and quote, and the total. The existing `booking_guard_immutable` trigger enforces it.
- **The current schedule** lives in new columns: `schedule_revision` (1 = the original), and `schedule_hold_id`, `schedule_starts_at`, `schedule_ends_at` (null while the booking is original).
- **`booking_schedule`** is append-only history: revision, change, previous hold and new hold.
- **`booking_change`** keeps every request: requester, reason, from and to slots, step, outcome, refusal, settlement and attention.
  - The request facts never change, and a finished change is history (trigger).
  - Deletion is refused.
- **Cancellation is final.** The `booking_guard_change` trigger refuses any change to `cancelled_at`, the reason or the status once set. It also allows the schedule to move only from `CONFIRMED`, one revision at a time.

## Money: late payment, payment during a reschedule

- **A reschedule never calls Billing.** The obligation, its amount and any payment in flight are untouched, so a payment that arrives during a reschedule settles the same obligation. Tests assert zero Billing calls.
- **A cancellation asks Billing to settle** (`VOIDED` / `REFUND_PENDING` / `NOTHING_DUE`).
  - A payment reported before cancellation gives `REFUND_PENDING`, a refund case for Finance (B-06).
  - **Late payment after cancellation** is Billing's to absorb. A voided obligation already refuses new attempts (`OBLIGATION_VOIDED` in Billing's `assertOpen`). Money that arrives anyway must join the refund case; that requirement is in the Lane B CR.
- **Until Lane B serves the route** the saga stays at `SETTLE_BILLING` with `settlement: PENDING` and `attention`. It is never `COMPLETED`. Proven against a 404 route.

## Security and privacy

- Deny by default, as listed above.
- `UserCredential` is used only to read the customer's own new hold, during the customer's own request. It is never stored.
- Events and audit rows carry ids, slots, reasons and money only: no name, phone, address or plate. Tested.

## Evidence

Families:

- `unit`: domain decisions and HTTP adapters against a real `node:http` server.
- `postgres`: real PostgreSQL, runtime role, triggers and partial unique indexes.
- `lane`: compiled API and worker as real processes, SIGKILL, worker races.

Dispatch, Scheduling and Billing are **declared doubles** of the requested contracts here. The real Scheduling (P04-C1) and Dispatch (P04-C2) run together with this child in the P04-C merge candidate.

| Test | What it proves |
| --- | --- |
| `change.pg.spec.ts` | Every path above. Responses lost after each step still give one effect each. Concurrent requests with different keys give one change. Concurrent retries of one key give one change, and a replay after completion still answers. Validation refusals. Triggers. |
| `http.pg.spec.ts` | 202 then 200 on replay, 412 / 428 / 400 / 404 / 409 envelopes, the booking view's `schedule` / `cancellation` / `pendingChange`, history ordering. |
| `tests/production/C/booking-change-restart.test.mjs` | A replace applied with its answer lost and the API killed: the worker replays it once. Billing absent across worker kills, then settles. Two workers racing four changes: one event each. |

## Rollback

- The previous binary ignores the new columns and tables. While no booking is `CANCELLED` or rescheduled, every row is valid for it.
- Once changes exist, keep this binary: the previous code would show a rescheduled booking at its original slot.
- The migration is additive and stays in place. No data is rewritten.
