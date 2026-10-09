# P02-C1 — Scheduling provider conforms to the published `scheduling.v1`

Child 1 of P02-C (durable Booking coordinator and initial Dispatch). Base:
`main` at `566d2e7435dac0803d075556fff43c435f8a29a7`
(tree `1bd162f2578878643b3e2c2cc437fece36716588`).

P01-C1 shipped a capacity/hold API before Lane E published `scheduling.v1`
(P01-E1). The published contract is principal-owned: a customer (account or
guest) holds a slot for itself, Booking commits it with a service scope. This
child makes the provider serve exactly that contract so Booking (P02-C2) can
consume the published shape instead of a private one.

## Published surface served (`/internal/v1/scheduling`)

| Route | Access | Behaviour |
| --- | --- | --- |
| `GET /availability?zoneId&date&durationMinutes` | public | Slots of one `Asia/Damascus` civil day, cut from OPEN windows at their start every `durationMinutes`; `LIMITED` when one unit is free |
| `GET /availability/earliest?zoneId&durationMinutes` | public | First civil day (30-day horizon) with a slot |
| `POST /holds` | principal | Hold one unit of the window covering `[startsAt, startsAt+duration)`; beneficiary must be the caller (same kind and subject); 10 min TTL; max 3 live holds per principal |
| `GET /holds/:holdId` | principal | Beneficiary only; any other principal gets 404; operations may read |
| `POST /holds/:holdId/commit` | `service:scheduling.hold.commit` | HELD -> COMMITTED with `bookingId`; held unit becomes reserved |
| `POST /holds/:holdId/release` | principal | Beneficiary releases a live HELD hold (`CUSTOMER_CHANGED`, `BOOKING_FAILED`, `EXPIRED_BY_CLIENT`) |

Owner-only staff routes stay: `POST /windows`, `PATCH /windows/:id/capacity`,
`POST /windows/:id/close`, and `POST /holds/:holdId/override-release`
(`operations.dispatch`, audited; the only way to free a COMMITTED unit until a
contract route exists — see CR-P02-C1 §3).

## Commit and release semantics (what Booking relies on)

Commit, evaluated in this order:

1. Same `Idempotency-Key` and same body as a completed commit: the stored
   response, verbatim.
2. Hold already COMMITTED to the **same** `bookingId`: `200` with the hold,
   whatever `expectedRevision` says and whatever key is used (response-loss
   replay; no event, no change).
3. Hold COMMITTED to another booking or RELEASED: `422 BUSINESS_RULE_VIOLATION`
   reason `HOLD_NOT_ACTIVE`.
4. Deadline reached (or already EXPIRED): `422 BUSINESS_RULE_VIOLATION` reason
   `HOLD_EXPIRED`. The expiry itself is committed (event emitted, unit
   returned) and the idempotency claim is dropped, so a retry is re-evaluated
   and can never turn into success.
5. `expectedRevision` differs: `412 REVISION_CONFLICT`.
6. Otherwise commit: `200`, `revision + 1`.

Also: unknown hold `404 NOT_FOUND`; caller without the scope `403 AUTH_FORBIDDEN`;
missing key `428 IDEMPOTENCY_KEY_REQUIRED`; same key different body `409
IDEMPOTENCY_CONFLICT`; key held by an unfinished concurrent request for more than
3 s `409 IDEMPOTENCY_IN_PROGRESS` (retryable); the booking already committed a
different hold `409 CONFLICT` reason `BOOKING_ALREADY_COMMITTED` (unique index).

Release: beneficiary only (others 404); HELD and live only, otherwise
`HOLD_NOT_ACTIVE` / `HOLD_EXPIRED`; revision-checked (`412`); same key replays.
A COMMITTED hold cannot be released through `scheduling.v1`.

Create: no covering OPEN window, window full, slot started: `422` reason
`SLOT_UNAVAILABLE`; more than 30 days ahead: `OUTSIDE_HORIZON`; more than 3 live
holds for the principal: `422` reason `HOLD_LIMIT_REACHED` (not in the published
reason allowlist — requested in CR-P02-C1 §5).

Errors are the published envelope with `retryable` derived from `code`
(`DEPENDENCY_UNAVAILABLE`, `RATE_LIMITED`, `IDEMPOTENCY_IN_PROGRESS` only).
Malformed JSON and unknown routes use the same envelope (global filter).

## Events

`scheduling.hold-changed.v1` (envelope v2, exchange `scheduling.events`, routing
key = event type) for every state change — HELD, COMMITTED, RELEASED (also staff
cancellation of a committed hold, `bookingId: null` as the published parser
requires), EXPIRED (actor `system`). Written in the same transaction as the
change via the outbox; `traceparent` is the active W3C trace when the change
committed, never invented. No personal data: opaque ids and the slot only.

## Idempotency

`(scope, key) -> (sha256 fingerprint, completed outcome)` in `idempotency_record`,
same transaction as the change. Scope = `scheduling.v1:<operation>:<actor>`;
fingerprint = canonical JSON (sorted keys, NFC) of `{v, contract, operation,
actor, target, body}` exactly as `idempotencyMaterial` defines. Only successes
are stored. Retention 7 days by the database clock, purged by the hold-expiry
worker.

## Migration `20261008100000_p02c1_scheduling_v1`

Expand-only with respect to running code: new nullable v1 columns on
`capacity_hold`; the four C1 request columns become nullable (C1 rows keep their
values; the C1 unique index stays); the release-reason CHECK is widened; new
`capacity_hold_shape_ck` (a row is either a complete C1 row or a complete v1 row),
partial unique index on `booking_id`, beneficiary and covering-window indexes,
new table `idempotency_record`. Nothing dropped, no row rewritten.
`prisma migrate diff` (migrated database vs `schema.prisma`) is empty.

Pre-v1 rows (only ever written in test environments — C1 was never deployed) are
invisible to the v1 routes; the sweeper still expires their due ACTIVE rows
without an event (their events were never published) so the units return.

Rollback: redeploy the previous image. The C1 code ignores the new columns, but
it would mis-read v1 rows (null client columns) on its removed routes; since the
C1 API has no consumer, the documented rollback window is "before any v1 hold
exists". Dropping columns/tables is a separate reviewed contract step.

## Evidence families

| Family | Real dependency | Suites |
| --- | --- | --- |
| unit | none | `test/unit/domain.spec.ts`, `test/unit/edge-security.spec.ts` |
| postgres | PostgreSQL 16.10, runtime role, 4 pools as replicas | `test/integration/holds.pg.spec.ts` |
| http | real Nest + PostgreSQL; Identity HTTP double | `test/integration/http.pg.spec.ts` |
| lane: broker | PostgreSQL + RabbitMQ 4.2 + shared `OutboxRelay`; messages parsed by the published event parser | `tests/production/C/scheduling-outbox-rabbitmq.test.mjs` |
| lane: restart | compiled API/worker processes, SIGKILL, `docker restart` of PostgreSQL | `tests/production/C/scheduling-restart.test.mjs` |
| lane: provider contract | compiled service process; every response/error/event parsed by the PUBLISHED `@carwash/contracts` / `@carwash/event-contracts` parsers | `tests/production/C/scheduling-v1-provider.test.mjs` |
| existing | generated Nest runtime spec | `test/scheduling.nest.spec.ts` |

Defects found by these suites while building this child and fixed before commit:
the earlier WIP rolled back the expiry it meant to commit on `HOLD_EXPIRED`
(error thrown inside the transaction); an already-EXPIRED hold reported
`HOLD_NOT_ACTIVE` instead of `HOLD_EXPIRED`; malformed JSON bypassed the
controller filter and answered in Nest's default shape.

Not proven here: Identity token verification (Identity's suites), a deployed
relay process and broker ACLs (CR-C1), gateway exposure of the public routes
(CR-P02-C1 §4), multi-node PostgreSQL failover, load beyond the concurrency
tests above, real Booking traffic (P02-C2 is the next consumer).
