# P04-C1: Scheduling commitment changes for booking cancellation and reschedule

Parent: **P04-C** (Lane C). Parent status: **INTEGRATION_PENDING**.
Shared spec: [`P04-C-interfaces.md`](P04-C-interfaces.md), §C1.
Contract request: [`CR-P04-C1-scheduling-commitment-changes.md`](contract-requests/CR-P04-C1-scheduling-commitment-changes.md).

## Problem

`scheduling.v1` lets Booking commit a hold (the pivot of the creation saga), but gives it no way to change a commitment afterwards.

- **Cancellation:** a cancelled booking keeps its unit reserved. Only a staff override can free it.
- **Reschedule:** a booking can never move. The partial unique index on `booking_id` also covered `CANCELLED` rows, so a booking could not commit a second hold even after its first one was given back.

## What this child adds

| Item | Where |
| --- | --- |
| `releaseCommitment(hold, {bookingId})`: `CONFIRMED` becomes `CANCELLED` (`BOOKING_CANCELLED`). A hold already given back for the booking is a replay, except one the booking was moved away from. | `src/domain/hold.ts` |
| `replaceCommitment(from, to, {bookingId, expectedRevision})`: one decision that moves the commitment. Refuses another beneficiary's hold (reported as absent), a stale revision, an expired or inactive hold, or a booking that is not committed. | `src/domain/hold.ts` |
| `CommitmentsService`: an idempotent, fenced transaction. Lock order: idempotency, then windows by id, then holds by id. The old row is written first. The new hold's expiry is committed, then reported as `HOLD_EXPIRED`. | `src/application/commitments.service.ts` |
| `POST /bookings/:bookingId/commitment/release` and `/replace`, with service scope `scheduling.commitment.change` | `src/transport/http/scheduling.controller.ts`, `wire.ts` |
| Migration `20261011090000_p04c1_booking_commitment_changes`: one **CONFIRMED** hold per booking. The new index is created before the old one is dropped. | `prisma/migrations/` |

## Capacity arithmetic (exact)

| Change | Old window | New window |
| --- | --- | --- |
| release | `reserved - 1` | n/a |
| replace, two windows | `reserved - 1` | `held - 1`, `reserved + 1` |
| replace, same window | `held - 1`, `reserved + 1 - 1` (one write) | (same) |

Every window is written once, guarded by the version read under its row lock. The `held + reserved <= capacity` CHECK still applies to every write.

## Events

`scheduling.hold-changed.v1` (*published*) is emitted once per changed hold, in the same transaction:

- release: `RELEASED`;
- replace: `RELEASED` for the old hold, and `COMMITTED` (with the booking id) for the new one.

Both rows of one transaction share `created_at`, so the relative order of the two holds on the broker is not guaranteed. Consumers must not rely on it. Dispatch does not (see P04-C2).

## Security

- **Deny by default.** Only a configured service client holding `scheduling.commitment.change` may call these routes. Principals, staff and the commit-only scope get 403.
- **Ownership.** A principal's own hold can only replace a commitment of the same principal. Another principal's hold is reported as `NOT_FOUND`, never as forbidden.
- **Privacy.** Audit rows carry ids, the reason and the unit count only. No personal data appears in events, logs or URLs.

## Rollback

- Redeploying the previous binary is safe: it never calls the new routes, and it maps the new index's unique violation exactly as before.
- Dropping the new index and recreating the old one fails once any booking has both a `CANCELLED` and a `CONFIRMED` row, so the new index stays.
- No data is rewritten or deleted.

## Evidence

See the PR description. Families: `unit`, `postgres` (real PostgreSQL 16, runtime role, four pools as four replicas) and `lane` (real RabbitMQ 4.2 with the published parser).

| Test | What it proves |
| --- | --- |
| `test/unit/commitment.spec.ts` | Domain rules and refusals. |
| `test/integration/commitments.pg.spec.ts` | Capacity counters equal the hold rows after every change. 20 concurrent cancellations have one effect. Two concurrent reschedules to different holds have exactly one winner. A reschedule racing a staff override never leaves two commitments. An expired target leaves the original commitment in place. Scope denial. The database refuses a second `CONFIRMED` row. |
| `test/integration/http.pg.spec.ts` | Edge auth, strict bodies, replay by booking, and the published hold view. |
| `tests/production/C/scheduling-commitment-rabbitmq.test.mjs` | Events reach RabbitMQ once each and parse with the published parser. Retries publish nothing new. |

## Consumers

- **P04-C3 (Booking change saga):** calls both routes.
- **P04-C2 (Dispatch):** consumes the resulting `hold-changed` events (already subscribed).
