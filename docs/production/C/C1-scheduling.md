# C1 — Scheduling capacity, slot inventory and expiring holds

Child of P01-C. Base: `main` at `f875d31bf62b153b6d36ac7a607949f8c4e29389`
(tree `6177cc0112519b6b2c718e65c3b117f42a210bf5`).

## Responsibility boundary

Scheduling is the single authority for "is there a unit of capacity for this
zone and time". Booking orchestrates (and owns the booking state machine);
Scheduling never learns customer identity, address, vehicle or price. Holds
reference the caller's opaque `holderRef` (the booking id). Technician-level
assignment remains Dispatch; deriving window capacity from Workforce
availability is a later consumer of C2 events and is not claimed here.

## Architecture

```
transport/http  SchedulingController, ActorResolver, SchedulingHttpFilter
     │          (strict body parsing, UTC-only instants, per-actor budget)
application     SchedulingService (commands/queries), authorization policy
     │
domain          capacity-window, hold, events (pure functions, no I/O)
     │
ports           Clock, IdGenerator, SchedulingUnitOfWork/Transaction,
     │          SchedulingReadModel, Actor
infrastructure  PrismaSchedulingStore (SQL + row locks), PrismaOutboxStore,
                IdentitySessionClient (HTTP), ServiceClientAuthenticator
workers         hold-expiry.main (standalone process)
```

The layer guard (`scripts/check-layers.mjs`) passes: domain, application and
ports import no Nest, Prisma, pg or broker code.

## Invariants and where they are enforced

| Invariant | Application | Database |
| --- | --- | --- |
| never oversell: `held + reserved <= capacity` | `holdUnits` under `FOR UPDATE` | `capacity_window_no_oversell_ck` |
| no overlapping windows per zone | — | `capacity_window_no_overlap_ex` (gist, `[)` ranges) |
| one hold per idempotency key per client | replay/fingerprint check | unique `(client_id, idempotency_key)` + `ON CONFLICT DO NOTHING` |
| counters never negative | domain underflow guard | `capacity_window_counts_ck` |
| hold status / units / reason domains | domain types | CHECK constraints |
| lost update | version read under lock | `UPDATE … WHERE version = $expected` |
| racing window definitions in one zone | — | per-zone `pg_advisory_xact_lock`, then the exclusion constraint |

Lock order is window → hold everywhere (commands and sweeper), so the pair
cannot deadlock. Isolation is READ COMMITTED with explicit row locks: every
decision is made on rows read under `FOR UPDATE`.

## Expiry semantics

- The deadline is evaluated by the injected `Clock` on every command. A hold is
  due at `expiresAt` exactly; one millisecond earlier it still protects capacity.
- `acquire`, `confirm`, `release` and `changeCapacity` first expire the due holds
  of the window they locked, in the same transaction.
- Availability computes free units from deadlines (`expires_at > now`), so an
  unswept hold never hides capacity.
- The expiry worker only brings counters back and emits `hold-expired`
  promptly. It is stateless; any number of replicas use `SKIP LOCKED` and
  re-derive everything under the lock, so a crashed, stalled or duplicate worker
  cannot double-release. `data.expiredAt` is the deadline; `occurredAt` is when
  the expiry was recorded.

## Idempotency and replay policy

| Command | Key | Replay | Conflict |
| --- | --- | --- | --- |
| acquire hold | `Idempotency-Key` header (16–128 `[A-Za-z0-9_-]`) scoped to the service client | same key + same fingerprint (window, holder, units, ttl) returns the current hold, `200` | same key, different request: `422 IDEMPOTENCY_KEY_REUSED` |
| confirm | hold id | already `CONFIRMED`: `200` | expired: `409 HOLD_EXPIRED` (expiry committed); other terminal: `409 HOLD_NOT_ACTIVE` |
| release | hold id | already terminal: `200` with current state | — |
| define window | `(zone, startsAt)` | identical definition: `200` | different: `409 WINDOW_EXISTS`; overlap: `409 WINDOW_OVERLAPS` |
| capacity / close | `expectedVersion` | close of closed window: `200` | stale version: `409 VERSION_CONFLICT` |

A failed acquisition (for example `CAPACITY_EXHAUSTED`) is not cached; a retry is
re-evaluated. Two concurrent first requests with one key: the loser's insert
hits the unique key, its transaction rolls back (including its counter change)
and it returns the winner's hold.

## Saga contract for Booking (next consumer)

1. `POST /holds` with `holderRef = bookingId` and a key derived from the booking
   step (stable across retries). Timeout or 5xx: retry the same key; the outcome
   is never assumed.
2. Payment/other steps proceed while the hold is `ACTIVE`.
3. Success: `POST /holds/:id/confirm`. `409 HOLD_EXPIRED` means the slot was
   lost; Booking must ask the customer for a new time (the approved journey
   re-asks for a time, never reuses an expired one).
4. Compensation: `POST /holds/:id/release` with `BOOKING_FAILED`,
   `CUSTOMER_ABANDONED`, `RESCHEDULED`, or `BOOKING_CANCELLED` after confirmation.
   Release is idempotent and safe to repeat.
5. `scheduling.hold-expired.v1` lets Booking fail a waiting saga without polling.

## Security and privacy

- Deny by default. Users via Identity's session view (permissions from Identity,
  revocation honoured); services via digest-configured credentials with scopes.
- Object access: another client's hold is `404`, never `403`.
- Operations override uses a reserved reason and is audited (`audit_entry`).
- Responses omit client id, fingerprint and idempotency key. Events and audit
  rows carry opaque UUIDs only. Error bodies carry a correlation id, not internals.
- Per-actor request budget (process-local) answers 429.
- Interim mechanisms and their requested replacements are listed in CR-C1.

## Migration

`services/scheduling/prisma/migrations/20261007100000_c1_capacity_holds`:
expand-only (new extension `btree_gist`, four new tables, constraints, indexes).
Nothing existing is altered or dropped. Applied by `cw_scheduling_migrate`;
runtime role has DML only and no access to `_prisma_migrations`.
`prisma migrate diff` between the migrated database and `schema.prisma`
reports no difference (CHECK/EXCLUDE live in SQL only).

Rollback: the release is rolled back by redeploying the previous image; the
new tables are unused by it. Dropping them is a separate, reviewed contract
step with a backup, and is not part of this change.

## Evidence

Produced by `node scripts/production/C/verify.mjs scheduling` on a clean tree.
The exact commit, tree, image digests and per-family counts are in the PR
description. Families:

| Family | Real dependency | Suites |
| --- | --- | --- |
| unit | none (pure + stubs) | `test/unit/domain.spec.ts`, `test/unit/edge-security.spec.ts` |
| postgres | PostgreSQL 16.10, runtime role, 4 pools as replicas | `test/integration/capacity.pg.spec.ts` |
| http | real Nest server + PostgreSQL; Identity HTTP double | `test/integration/http.pg.spec.ts` |
| broker | PostgreSQL + RabbitMQ 4.2 + shared `OutboxRelay` | `tests/production/C/scheduling-outbox-rabbitmq.test.mjs` |
| restart | compiled API/worker processes, SIGKILL, `docker restart` of PostgreSQL | `tests/production/C/scheduling-restart.test.mjs` |
| existing | generated Nest runtime spec | `test/scheduling.nest.spec.ts` |

Defects found by these suites during development, and fixed:
- `hold-expired.data.expiredAt` carried the sweep time instead of the deadline.
- Concurrent overlapping window definitions deadlocked (`40P01`) inside the
  gist exclusion check in about a third of racing inserts and surfaced as 500.
  Fixed by serialising definitions per zone (`pg_advisory_xact_lock`), plus a
  bounded retry of the whole unit of work on `40P01`/`40001` and a 503 mapping
  for any conflict that survives the retries. The SQLSTATE reader also missed
  the adapter's `originalCode` shape.
- Lane stack: migrations ran without the acceptance post-migration hardening
  (runtime role could read `_prisma_migrations`); ephemeral Docker port mapping
  moved PostgreSQL to a new port on restart.

Not proven here: Identity token verification (owned and tested by Identity), a
deployed relay process (blocked on CR-C1), production broker ACLs/topology,
multi-node PostgreSQL failover, load beyond the concurrency tests above.
