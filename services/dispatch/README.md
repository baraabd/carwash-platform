# dispatch

Owner of job assignment: one assignment per confirmed booking, offers of that
job to workforce resources, acceptance, decline, expiry and reassignment. It
never owns the booking lifecycle, payment, capacity or technician personal
data. Design and evidence: `docs/production/C/P02-C3-dispatch.md`.

Status: assignment/offer API, hold-changed consumer parts and offer-expiry
worker implemented and verified on real PostgreSQL and RabbitMQ in the lane-C
stack. `/health/ready` still answers 503 (`BUSINESS_READY = false`): the
produced event and HTTP contract are not published by Lane E, the consumer
process is not wired (dependencies are Lane E's), and no release acceptance has
run on this source. Not production-ready.

## Model

- `assignment`: one per booking and per Scheduling hold (UNIQUE),
  `UNASSIGNED | OFFERED | ASSIGNED | CANCELLED`, job window `[startsAt, endsAt)`.
  A resource can never hold two ASSIGNED jobs whose windows overlap
  (`EXCLUDE USING gist`).
- `dispatch_offer`: `OFFERED -> ACCEPTED | DECLINED | EXPIRED`,
  `OFFERED | ACCEPTED -> WITHDRAWN`. At most one OFFERED and one ACCEPTED offer
  per assignment (partial UNIQUE indexes). Expiry is decided by the injected
  clock, never by whether the worker ran.
- `hold_observation`: highest Scheduling hold revision applied (event ordering).
- `inbox_message`, `outbox_message`, `idempotency_record`, `audit_entry`:
  written in the same transaction as the change.

Lock order everywhere: idempotency record -> hold observation -> assignment -> offer.

## API (`/internal/v1/dispatch`)

| Method | Path | Caller |
| --- | --- | --- |
| GET | `/assignments?zoneId&from&to[&status]` | user with `operations.dispatch` |
| GET | `/assignments/:id` | user with `operations.dispatch` |
| GET | `/bookings/:bookingId/assignment` | `operations.dispatch`, or service scope `dispatch.assignment.read` |
| POST | `/assignments/:id/offers` | `operations.dispatch`, `Idempotency-Key` |
| POST | `/assignments/:id/reassign` | `operations.dispatch`, `Idempotency-Key` |
| POST | `/assignments/:id/unassign` | `operations.dispatch`, `Idempotency-Key` |
| GET | `/me/offers` | technician, `work.read:assigned` |
| POST | `/offers/:id/accept` | technician named on the offer, `work.execute:assigned`, `Idempotency-Key` |
| POST | `/offers/:id/decline` | technician named on the offer, `work.execute:assigned`, `Idempotency-Key` |

## Processes

- `node dist/main.js`: HTTP API.
- `node dist/workers/offer-expiry.main.js [--once] [--batch N] [--interval-ms N]`:
  expiry worker and idempotency-retention purge (any number of replicas).
- Hold-changed consumer: `transport/messaging/hold-changed.consumer.ts` provides
  the parser, inbox store and effect for the shared `InboxConsumer`; the process
  itself waits for CR-P02-C3 §2.

## Configuration

`DATABASE_URL` (runtime role `cw_dispatch_app`), `IDENTITY_URL`,
`IDENTITY_TIMEOUT_MS`, `DISPATCH_SERVICE_CLIENTS` (JSON, SHA-256 digests only),
`DISPATCH_USER_REQUESTS_PER_MINUTE`, `DISPATCH_SERVICE_REQUESTS_PER_MINUTE`.
Migrations run only as `cw_dispatch_migrate` in a separate job; runtime startup
never migrates.
