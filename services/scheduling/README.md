# scheduling

Owner of bookable capacity: time windows per service zone, expiring capacity
holds and the reservations they become. It never owns bookings, payment or
technician assignment. Design and evidence: `docs/production/C/C1-scheduling.md`.

Status: capacity/hold API implemented and verified on real PostgreSQL and
RabbitMQ in the lane-C stack. `/health/ready` still answers 503
(`BUSINESS_READY = false`) because the public contracts are not yet published
by Lane E and no release acceptance has run on this source. Not production-ready.

## Model

- `capacity_window`: zone, half-open `[startsAt, endsAt)`, `capacity`, `held`,
  `reserved`, `OPEN|CLOSED`, `version`. The database enforces
  `held + reserved <= capacity` (CHECK) and forbids overlapping windows in one
  zone (`EXCLUDE USING gist`).
- `capacity_hold`: `ACTIVE -> CONFIRMED | RELEASED | EXPIRED`, `CONFIRMED -> CANCELLED`.
  Unique per `(client_id, idempotency_key)`. The deadline is evaluated with the
  injected clock on every command; a hold whose deadline passed never protects
  capacity, whether or not the expiry worker has run.
- `outbox_message`, `audit_entry`: written in the same transaction as the change.

Lock order is always window then hold, in every command and in the worker.

## API (`/internal/v1/scheduling`)

| Method | Path | Caller |
| --- | --- | --- |
| POST | `/windows` | user with `operations.dispatch` |
| PATCH | `/windows/:id/capacity` | user with `operations.dispatch` (`expectedVersion`) |
| POST | `/windows/:id/close` | user with `operations.dispatch` (`expectedVersion`) |
| GET | `/availability?zoneId&from&to` | customer (`bookings.create:self`, slot view), operations or service scope `scheduling.availability.read` (detailed) |
| POST | `/holds` (`Idempotency-Key` required) | service scope `scheduling.holds.write` |
| GET | `/holds/:id` | owning service, operations |
| POST | `/holds/:id/confirm` | owning service |
| POST | `/holds/:id/release` | owning service; operations with `OPERATIONS_OVERRIDE` |

Users are resolved through Identity's `GET /internal/v1/identity/session`
(`IDENTITY_URL`); `x-auth-*` headers are never trusted. Services authenticate
with `x-service-client` + `x-service-token`, configured as SHA-256 digests in
`SCHEDULING_SERVICE_CLIENTS`. Identity outage answers 503, never a guess.

## Processes

- API: `node dist/main.js` (`pnpm --filter @carwash/scheduling start`).
- Hold expiry: `node dist/workers/hold-expiry.main.js` (`start:hold-expiry`),
  any number of replicas; stateless and restart-safe.
- Outbox relay: rows are written and verified against the shared relay in
  tests, but no relay process is wired in this service until Lane E adds
  `@carwash/platform-messaging` as a dependency (CR-C1).

## Environment

`DATABASE_URL` (runtime role `cw_scheduling_app`), `IDENTITY_URL`,
`IDENTITY_TIMEOUT_MS` (2000), `SCHEDULING_SERVICE_CLIENTS`,
`SCHEDULING_USER_REQUESTS_PER_MINUTE` (120),
`SCHEDULING_SERVICE_REQUESTS_PER_MINUTE` (6000). Migrations run only as a
separate job with `cw_scheduling_migrate`; runtime startup never migrates.

## Commands

- `pnpm --filter @carwash/scheduling generate | build | typecheck`
- `pnpm --filter @carwash/scheduling test:unit`
- `node scripts/production/C/stack.mjs up` then
  `node scripts/production/C/verify.mjs scheduling` (all families, exact-source record)
