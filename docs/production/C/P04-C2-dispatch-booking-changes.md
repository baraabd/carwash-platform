# P04-C2: Dispatch booking changes and the work-progress gate

Parent: **P04-C** (Lane C). Parent status: **INTEGRATION_PENDING**.
Shared spec: [`P04-C-interfaces.md`](P04-C-interfaces.md), §C2.
Contract request: [`CR-P04-C2-dispatch-booking-changes.md`](contract-requests/CR-P04-C2-dispatch-booking-changes.md).

## Decision P04-C-D1: Dispatch is the work-progress gate

Booking cannot see whether a technician has left: `dispatch.task-progressed.v1` is still producer-pending, so its booking status stays `CONFIRMED` after assignment. Every booking change therefore asks Dispatch, which decides under the booking advisory lock and the assignment row lock. The same transaction withdraws the offer and ends a not-started task.

| Live task | Change allowed? | Refusal |
| --- | --- | --- |
| none, or `ACCEPTED` (technician has not left) | yes | n/a |
| `EN_ROUTE`, `ARRIVED`, `IN_SERVICE`, `DOCUMENTING`, `FINISHED` | no | `WORK_STARTED` (422) |
| `CLOSED` | no | `WORK_COMPLETED` (422) |

**Races.** Accept, depart and every later technician step lock the same assignment row, so each race has exactly one winner:

| Race | Outcome |
| --- | --- |
| Cancel vs accept | Either accept wins and the cancellation then ends the `ACCEPTED` task, or cancel wins and accept is refused. Proven ten times on real PostgreSQL. |
| Cancel vs depart | Either depart wins and the cancellation is refused `WORK_STARTED`, or cancel wins and depart is refused. Proven ten times on real PostgreSQL. |

## Commands (service scope `dispatch.booking.change`)

All commands require an `Idempotency-Key` and are replay-safe by Booking's `changeId`, which keys the new `booking_change` table.

| Command | Effect |
| --- | --- |
| `POST /bookings/:id/cancellation {changeId}` | Withdraws the offer (`JOB_CANCELLED`), cancels a not-started task, sets the assignment `CANCELLED` (`BOOKING_CANCELLED`), emits `dispatch.assignment-changed.v1`, and writes an audit row. With no job yet, it records a tombstone (`NOT_OPENED`), so a late `COMMITTED` event opens nothing. A second change id for the same booking answers with the first cancellation. A rebind left pending is closed too. |
| `POST /bookings/:id/rebinding {changeId, holdId, zoneId, startsAt, endsAt}` | Withdraws the offer and ends an `ACCEPTED` task (`JOB_RESCHEDULED`). Sets the job `UNASSIGNED` on the new hold and window, with `pending_change_id` set. Refusals: `ASSIGNMENT_NOT_OPEN` (409, the job is not opened yet, retry), `BOOKING_CANCELLED`, `RESCHEDULE_PENDING`, another zone, the same hold. |
| `POST /bookings/:id/rebinding/confirm {changeId}` | The binding becomes final. The new hold's `COMMITTED` event does the same if it arrives first (`BINDING_CONFIRMED`). |
| `POST /bookings/:id/rebinding/revert {changeId}` | Restores the original hold and window. If the revert arrives before the rebind, it leaves a tombstone, and a late rebind with that change id is refused `CHANGE_REVERTED`. A confirmed change cannot be reverted (`CHANGE_CONFIRMED`). |

While a binding is pending, no offer can be made (`RESCHEDULE_PENDING`).

## Hold-changed consumer (published `scheduling.hold-changed.v1`)

- **`COMMITTED`:**
  - With a cancellation recorded for the booking, nothing opens (`SUPPRESSED_CANCELLED`, audited).
  - With a pending rebind to that hold, the binding is confirmed.
  - Both checks run under the booking lock, which serialises them against Booking's commands.
- **`RELEASED` / `EXPIRED`:** while the job's binding is pending, the job is **kept** (`PENDING_BINDING_KEPT`, audited). Booking's saga confirms or reverts the binding. An uncommitted hold expiring must never cancel a booked job.
- **Ordering:** Scheduling's replace publishes old `RELEASED` and new `COMMITTED` in no guaranteed relative order. Because the rebind happens before the replace, the job is already bound to the new hold either way. Proven over real RabbitMQ in both orders, with redelivery.

## Persistence

Migration `20261011100000_p04c2_booking_changes` is expand-only. Every existing row stays valid; nothing is dropped or rewritten.

- **Assignment:** `assignment.pending_change_id`, with the CHECK that a `CANCELLED` job is never pending.
- **Widened CHECKs:**
  - cancel reason `BOOKING_CANCELLED`;
  - withdraw and task end reason `JOB_RESCHEDULED`;
  - idempotency result `BOOKING_CHANGE`;
  - audit target `BOOKING`.
- **`booking_change`:** one cancellation per booking and one pending rebind per booking (partial unique), slot-shape CHECKs, and an FK to the assignment.

Lock order, extended: idempotency, then hold or resource observation, then **booking (advisory)**, then assignments, then offer, then task.

## Technician-visible effect (declared)

- A rescheduled or cancelled job disappears from the technician app. The task is `WITHDRAWN`/`CANCELLED`, which C5 already treats as "not your work any more".
- After a reschedule the technician must accept the new time again. Whether the same technician should be kept automatically is owner decision **TI-D06**, still open.

## Evidence

See the PR. Families: `unit` (domain gate and rebind lifecycle), `postgres` (real PostgreSQL, two pools) and `lane` (real RabbitMQ, published parser).

| Test | What it proves |
| --- | --- |
| `test/unit/booking-change-domain.spec.ts` | The domain gate and the rebind lifecycle. |
| `test/integration/booking-change.pg.spec.ts` | Tombstone; cancel effects; `WORK_STARTED` refusal with nothing recorded; accept and depart races; 20 concurrent cancels; rebind, confirm and revert lifecycle; expiry kept; refusals; scope; database invariants. |
| `http.pg.spec.ts` | The edge: scope, strict bodies, UTC-only instants, replay, the error envelope. |
| `tests/production/C/dispatch-booking-change-rabbitmq.test.mjs` | Tombstone over the broker; both event orders; expiry kept, then revert; nothing dead-lettered. |

## Rollback

The previous binary ignores `pending_change_id`. While no rebind is pending, every row is valid for it. Before rolling back, finish or revert pending rebinds:

```sql
SELECT count(*) FROM app.assignment WHERE pending_change_id IS NOT NULL;
```

The migration is additive and stays in place.
