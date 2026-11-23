# P02-D1: Reporting operations projections and read API

Parent task: P02-D (admin technician-review and booking operations read
surfaces). Parent status: **INTEGRATION_PENDING**.

This child is the provider half. It is reviewable on its own. It is not
production-ready, not deployed, and not fed by any live producer (see
CR-D-P02-03). The consumer half is P02-D2 (`apps/admin-web`).

## Scope

| Path | Change |
| --- | --- |
| `services/reporting/src/domain/operations.ts` | Pure rules: monotonic facts, hold to booking link, current slot, derived status, freshness, bounded inputs |
| `services/reporting/src/application/operations.service.ts` | Published contract parsing, projector, queries with derived/authority/freshness metadata |
| `services/reporting/src/application/access.ts` | Read permissions (D-P02-01) and per-subject read budget |
| `services/reporting/src/ports/{operations,identity}.ports.ts` | Writer/reader and session-authority ports |
| `services/reporting/src/infrastructure/persistence/prisma-operations.store.ts` | Transaction-bound writer (advisory locks, ordered) and keyset-paged reader |
| `services/reporting/src/infrastructure/identity/identity-session.client.ts` | Fail-closed Identity `/session` client |
| `services/reporting/src/infrastructure/messaging/operations-topology.ts` | Subscriber-owned queue, DLX and DLQ |
| `services/reporting/src/inbox/operations-consumer.runner.ts` | Worker: inbox and projection in one transaction, then ACK |
| `services/reporting/src/transport/http/operations.controller.ts` | `GET /internal/v1/reporting/operations/{bookings,bookings/:id,resources,freshness}` |
| `services/reporting/prisma/migrations/20261008090000_p02d_operations_projections` | Additive migration |
| `tests/production/D/reporting-operations.test.mjs`, `tests/production/D/_identity.mjs` | Real PostgreSQL, RabbitMQ and Identity suites |
| `scripts/production/D/run-real-infra.mjs` | Also migrates Identity and Workforce; owns a disposable Redis for Identity |

## What the projection holds

Reporting never decides a booking, slot, assignment or verification fact. It
folds the owners' **published** events into three derived tables. Every row
keeps the source event, its occurrence time and the owner's aggregate version.

| Table | Key | Source event |
| --- | --- | --- |
| `ops_booking` | booking | `booking.confirmed.v1`, plus the current slot recomputed from linked holds |
| `ops_slot_hold` | hold | `scheduling.hold-changed.v1` |
| `ops_resource_eligibility` | capacity resource | `workforce.eligibility-changed.v1` |
| `ops_freshness` | source | every applied, stale or repeated fact |

There is no name, phone, address, plate or price. `customer_ref` is the opaque
customer id carried by the contract, and the read API returns it only to
`operations.dispatch` callers.

### Rules (all in the pure domain, all unit-tested)

- **Monotonic versions per aggregate.** A newer version applies. An older one
  is `STALE`. The same version with the same fingerprint is `SAME`. The same
  version with different content throws `FACT_VERSION_CONFLICT`.
- **A hold belongs to one booking for life.** The contract carries
  `bookingId` only on `COMMITTED`, so the link is learned from whichever
  delivery carries it, even a stale one. A different booking for the same
  hold throws `HOLD_BOOKING_CONFLICT`.
- **Current slot is independent of delivery order.** A committed hold wins
  over released or expired ones; among those, the latest occurrence wins, with
  the hold id as tie-break. This covers a reschedule whose old release occurs
  and arrives after the new commit (suite A3: four arrival orders).
- **Derived status** (`SCHEDULED`, `CONFIRMED_UNSCHEDULED`,
  `SLOT_COMMITTED_UNCONFIRMED`, `SLOT_RELEASED`) is a discovery aid. Every
  response names Booking, Scheduling and Dispatch as the owners of the
  authoritative state.
- **Freshness** is per source: `NO_DATA`, `FRESH` (something applied within 15
  minutes) or `STALE`. It also reports the last occurrence, the last applied
  time, the ingestion lag and an exact applied count. Without producer
  heartbeats, `STALE` cannot distinguish a quiet producer from a broken
  pipeline, and the API does not pretend otherwise.

### Concurrency and transactions

One delivery is one local transaction: inbox row, derived rows and the
freshness checkpoint commit together, and the ACK follows the commit.
Transaction-scoped advisory locks always take the hold before the booking
(`ops-hold:*`, then `ops-booking:*`), so writers cannot deadlock. The current
slot is recomputed from all linked holds under the booking lock. Freshness uses
a native `INSERT .. ON CONFLICT` increment, and its occurrence clock only moves
forward.

### Database-enforced invariants (migration `20261008090000_p02d_operations_projections`)

The migration is additive (expand only). It adds four tables, five indexes and
CHECK constraints:

- closed vocabularies for hold state, eligibility and source;
- positive versions;
- `ends_at > starts_at`;
- hex fingerprints;
- a confirmation that is all-or-nothing;
- a slot that is all-or-nothing;
- a booking row that holds at least one fact;
- a positive applied count.

The runtime identity holds DML only: no TRUNCATE, ALTER or DROP (suite A7).
Rollback: the application has no dependency on these tables before this
change, so dropping them is a reviewed contract step. It is not needed to roll
back the code, which only stops reading them.

## Read API (`reporting.operations`, served by Reporting)

Every response has `derived: true`, an `authority` list of the owners and
their facts, and a per-source `freshness` array. No endpoint mutates
anything.

| Route | Permission (D-P02-01) | Notes |
| --- | --- | --- |
| `GET bookings?from&to[&zoneId][&status][&limit][&cursor]` | `operations.dispatch` | UTC instants. The window must be positive and at most 31 days. `limit` is 1-100 (default 25). An opaque keyset cursor; unscheduled bookings are discovered by confirmation time |
| `GET bookings/:bookingId` | `operations.dispatch` | Adds `holds` (at most 50). `404 NOT_PROJECTED` when unknown |
| `GET resources[?eligibility][&limit][&cursor]` | `operations.dispatch` or `verification.review` | Adds `summary {eligible, ineligible}` |
| `GET freshness` | either | Freshness of all three sources |

Errors use the service envelope:

- `401 AUTH_REQUIRED`: no or unknown credential, a revoked session, or a
  forwarded subject that disagrees with Identity;
- `403 AUTH_FORBIDDEN`;
- `422` with a stable code (for example `INVALID_WINDOW`, `INVALID_CURSOR`,
  `INVALID_LIMIT`);
- `429 AUTH_RATE_LIMITED`;
- `503 AUTH_UNAVAILABLE`: Identity is unreachable, slow (2 s deadline) or
  answers with a malformed body. This is never an allow.

Each read logs one audit line with the read name, subject, correlation id and
the allow/deny decision. It never logs the rows. The per-subject budget is
`REPORTING_READS_PER_MINUTE` (default 120). It is process-local by design;
global quotas belong to the edge.

## Evidence

Command (exact final tree; acceptance stack from
`node scripts/dev/acceptance-infra.mjs up`):

```
pnpm generate && pnpm build
node scripts/production/D/run-real-infra.mjs --evidence docs/production/D/evidence/p02-d1-real-infra.json
```

What is real and what is not:

| Dependency | Real? |
| --- | --- |
| PostgreSQL 16 (runtime and migration identities, privilege hardening, drift check) | real |
| RabbitMQ 4 (quorum queue, delivery limit, DLX/DLQ, ACLs) | real, single node |
| Identity (Argon2, RS256, sessions, role grants through `POST /accounts/:id/roles`, suspension) | real. Only OTP delivery is captured in-process, and one bootstrap super-admin is seeded with the identity migration identity |
| Redis (Identity rate budget) | real, disposable |
| Booking/Scheduling/Workforce producers | **not real**: the infrastructure identity publishes published-contract-shaped events (CR-D-P02-03) |
| Gateway | not involved: the routes do not exist (CR-D-P02-01) |

Suites in `tests/production/D/reporting-operations.test.mjs`:

- **A1-A8:** persistence rules, delivery-order independence, reschedule,
  integrity conflicts, concurrent deliveries (8 in flight), freshness counting,
  CHECK constraints and privileges, paging, filters and owner metadata.
- **B1:** the accepted broker ACL refuses the bindings with 403.
- **B2:** the real worker, with the requested ACL applied by the infrastructure
  administrator and restored afterwards. It covers:
  - three identical deliveries produce one effect;
  - a crash between commit and ACK gives a `DUPLICATE` on redelivery;
  - a contradictory hold link is NACKed and then dead-lettered, with no inbox
    row;
  - the local Workforce shape is dead-lettered on parse;
  - the logs contain no customer reference.
- **C1-C2:** the real HTTP adapter with real Identity. It covers 401, 403 per
  role, 200 per role, 404 and 422, forged forwarded subjects, immediate
  revocation on suspension, `503` when Identity is down, and a per-subject 429
  that does not affect a second subject.

The full Lane D gate (all five Lane D suites, including P01-D1/D2/D3) passed
61/61 on the final source. The run's JSON is committed under
`docs/production/D/evidence/`.

## Not proven here (blockers)

- No producer emits these contracts on the accepted topology (CR-D-P02-03), so
  the projection is empty in every deployment.
- Gateway routes and query support (CR-D-P02-01) are missing, so no browser
  can reach this API on `main`.
- Permission decision D-P02-01 is pending (CR-D-P02-02).
- No HA broker, no production database, no load or soak beyond the bounded
  concurrency cases.

## Next consumer

P02-D2 `apps/admin-web` operations console. It does not import this branch: it
reads the documented wire shape through the requested Gateway routes.
