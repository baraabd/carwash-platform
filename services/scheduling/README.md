# scheduling

Owner of bookable capacity: time windows per service zone, expiring slot holds
owned by a principal (account or guest), and the reservations Booking commits
them into. It never owns bookings, payment or technician assignment.
Design and evidence: `docs/production/C/C1-scheduling.md` (capacity model) and
`docs/production/C/P02-C1-scheduling-v1.md` (published `scheduling.v1` surface).

Status: `scheduling.v1` provider implemented and verified on real PostgreSQL and
RabbitMQ in the lane-C stack, with responses and events checked by the parsers
Lane E published. `/health/ready` still answers 503 (`BUSINESS_READY = false`):
no release acceptance has run on this source. Not production-ready.

## Model

- `capacity_window`: zone, half-open `[startsAt, endsAt)`, `capacity`, `held`,
  `reserved`, `OPEN|CLOSED`, `version`. The database enforces
  `held + reserved <= capacity` (CHECK) and forbids overlapping windows in one
  zone (`EXCLUDE USING gist`). One unit is one crew for the whole window.
- `capacity_hold` (v1 rows): beneficiary, zone, slot `[startsAt, endsAt)`, quote
  reference, `ACTIVE -> CONFIRMED | RELEASED | EXPIRED`, `CONFIRMED -> CANCELLED`
  (staff override). Published states: HELD, COMMITTED, RELEASED, EXPIRED.
  `capacity_hold_shape_ck` enforces complete rows; a partial unique index lets
  one booking commit at most one hold. The deadline is evaluated with the
  injected clock on every command.
- `idempotency_record`: protocol idempotency `(scope, key) -> fingerprint,
  outcome`, written in the same transaction as the change; 7-day retention.
- `outbox_message`, `audit_entry`: written in the same transaction as the change.

Lock order: idempotency record -> beneficiary (advisory) -> window -> hold.

## API (`/internal/v1/scheduling`)

| Method | Path | Caller |
| --- | --- | --- |
| GET | `/availability?zoneId&date&durationMinutes` | public (per-peer budget) |
| GET | `/availability/earliest?zoneId&durationMinutes` | public (per-peer budget) |
| POST | `/holds` (`Idempotency-Key`) | principal, for itself only |
| GET | `/holds/:holdId` | the beneficiary (others: 404), operations |
| POST | `/holds/:holdId/commit` (`Idempotency-Key`) | service scope `scheduling.hold.commit` (Booking) |
| POST | `/holds/:holdId/release` (`Idempotency-Key`) | the beneficiary, HELD holds only |
| POST | `/windows` | `operations.dispatch` (owner staff surface) |
| PATCH | `/windows/:id/capacity` | `operations.dispatch` (`expectedVersion`) |
| POST | `/windows/:id/close` | `operations.dispatch` (`expectedVersion`) |
| POST | `/holds/:holdId/override-release` | `operations.dispatch`, audited |

Errors use the published envelope `{error:{code, reason, ...}}`. Users are
resolved through Identity's `GET /internal/v1/identity/session` (`IDENTITY_URL`),
including `principalKind`; `x-auth-*` headers are never trusted. Services
authenticate with `x-service-client` + `x-service-token`, configured as SHA-256
digests in `SCHEDULING_SERVICE_CLIENTS` (interim, CR-C1 §4). Identity outage
answers 503, never a guess.

## Processes

- API: `node dist/main.js` (`pnpm --filter @carwash/scheduling start`).
- Hold expiry + idempotency retention: `node dist/workers/hold-expiry.main.js`
  (same image, separate process), any number of replicas; stateless, restart-safe.
- Outbox relay: rows are verified against the shared relay in tests, but no relay
  process is wired in this service until Lane E adds `@carwash/platform-messaging`
  as a dependency (CR-C1, CR-P02-C1).

## Environment

`DATABASE_URL` (runtime role `cw_scheduling_app`), `IDENTITY_URL`,
`IDENTITY_TIMEOUT_MS` (2000), `SCHEDULING_SERVICE_CLIENTS`,
`SCHEDULING_USER_REQUESTS_PER_MINUTE` (120),
`SCHEDULING_SERVICE_REQUESTS_PER_MINUTE` (6000),
`SCHEDULING_PUBLIC_REQUESTS_PER_MINUTE` (600). Migrations run only as a separate
job with `cw_scheduling_migrate`; runtime startup never migrates.

## Commands

- `pnpm --filter @carwash/scheduling generate | build | typecheck`
- `node scripts/production/C/stack.mjs up` then
  `node scripts/production/C/verify.mjs scheduling` (all families, exact-source record)
