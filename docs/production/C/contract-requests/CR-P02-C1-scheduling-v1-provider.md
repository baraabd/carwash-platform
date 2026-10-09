# CR-P02-C1 — scheduling.v1 provider prerequisites (request to Lane E)

Requester: Lane C (P02-C1). Provider: `services/scheduling`. Lane C does not edit
shared packages, lockfiles, CI, gateway, infra or architecture. Items of CR-C1
that are still open remain open; this request adds what `scheduling.v1`
conformance surfaced.

## 1. Dependencies (lockfile)

Add `@carwash/contracts: workspace:*` to `services/scheduling/package.json` so the
provider types its edge from `scheduling/v1` and `common/errors` instead of the
local mirror in `src/transport/http/wire.ts` and `http-errors.ts` (today the
mirror is proven equal by `tests/production/C/scheduling-v1-provider.test.mjs`).
`@carwash/platform-messaging` for the relay process is still requested (CR-C1 §2).

## 2. Workload identity and scope grant

Grant the Booking workload `service:scheduling.hold.commit` (the only scope this
provider now accepts; the C1 scopes `scheduling.holds.write` and
`scheduling.availability.read` are retired). Until platform workload identity
exists, the interim digest credential in `SCHEDULING_SERVICE_CLIENTS` is used.

## 3. Committed-hold cancellation (contract gap)

`scheduling.v1` has no way for Booking to give back a COMMITTED unit (booking
cancelled, or a saga step after commit failed). Today only the owner staff route
`POST /holds/:holdId/override-release` (`operations.dispatch`, audited) does it.
Request: a `cancelCommitment` route, e.g.
`POST /holds/:holdId/cancel` with access `service:scheduling.hold.commit`,
body `{expectedRevision, bookingId, reason: 'BOOKING_CANCELLED'|'BOOKING_FAILED'}`,
idempotent, emitting `hold-changed` RELEASED. Booking should order its saga so the
commit is the last remote step until this exists.

## 4. Gateway

Expose `GET /availability` and `GET /availability/earliest` as public routes with
query forwarding (`zoneId`, `date`, `durationMinutes`), and `POST /holds`,
`GET /holds/:holdId`, `POST /holds/:holdId/release` for account and guest
principals. `commit` must never be exposed through the Gateway.

## 5. Reason allowlist

Add `HOLD_LIMIT_REACHED` (anti-hoarding: more than 3 live holds per principal) to
`SCHEDULING_V1.reasons`, so the Gateway can forward it; until then it is stripped
and clients see `BUSINESS_RULE_VIOLATION` without a reason.

## 6. Ownership registry

Declare `docs/production/C/**`, `scripts/production/C/**` and
`tests/production/C/**` as Lane C (repeat of CR-C1 §8).
