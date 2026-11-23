# P02-C3 — Initial Dispatch provider: assignments and offers

Child of P02-C (Lane C: durable Booking coordinator and initial Dispatch
provider). One branch, one PR from `main`; not stacked on any other child.
Parent status remains **INTEGRATION_PENDING** until the Booking saga (C2), the
Scheduling v1 conformance (C1) and this child pass together.

## Responsibility boundary

Dispatch owns *who does the job*: one assignment per confirmed booking, offers
of that job to workforce resources, acceptance, decline, expiry, reassignment
and cancellation. Booking owns the booking lifecycle and never stores a
technician; Dispatch never stores customer, contact, address, vehicle or price.
Dispatch learns the job window from Scheduling, not from Booking tables.

### Why a COMMITTED hold opens a job

The job source is the PUBLISHED `scheduling.hold-changed.v1` (envelope v2,
`@carwash/event-contracts` business-v1, exchange `scheduling.events`). In the
Booking saga the hold commit is the **pivot**: Booking commits the hold only
after every compensatable step succeeded, and nothing after it can fail
permanently (Booking's own confirmation is a local replayable write). A
COMMITTED hold therefore means a confirmed booking for exactly that slot, and
its `bookingId` is authoritative. RELEASED or EXPIRED afterwards means the slot
is gone, so the job is cancelled and any live or accepted offer is withdrawn.
This avoids consuming an unpublished booking event; if Booking later publishes
its own confirmed/cancelled event, Dispatch can switch sources without a schema
change (the assignment is keyed by booking and hold).

## Architecture

```
transport/http       DispatchController, ActorResolver, DispatchHttpFilter
                     (closed bodies, UTC-only instants, per-actor budget,
                      shared API error envelope)
transport/messaging  holdChangedConsumerParts (published parser + inbox store + effect)
     │
application          DispatchService (commands/queries, idempotency, authorization),
     │               HoldChangeHandler (inbox effect)
domain               assignment, offer, hold-observation, events (pure)
     │
ports                Clock, IdGenerator, DispatchUnitOfWork/Transaction, DispatchReadModel
infrastructure       PrismaDispatchStore (SQL + row locks), PrismaInboxStore,
                     PrismaOutboxStore, IdentitySessionClient (HTTP), ServiceClientAuthenticator
workers              offer-expiry.main (standalone process)
```

`scripts/check-layers.mjs` passes: domain, application and ports import no
Nest, Prisma, pg or broker code. The application imports only the published
`@carwash/event-contracts` (already a declared dependency) for the consumed
event's parser and the envelope v2 types.

## State machines

```
assignment: UNASSIGNED -> OFFERED -> ASSIGNED
            OFFERED -> UNASSIGNED     (decline, expiry, unassign, reassign)
            ASSIGNED -> UNASSIGNED    (unassign, reassign)
            any -> CANCELLED          (slot released/expired; terminal)
offer:      OFFERED -> ACCEPTED | DECLINED | EXPIRED
            OFFERED | ACCEPTED -> WITHDRAWN (REASSIGNED | UNASSIGNED | JOB_CANCELLED)
```

## Invariants and where they are enforced

| Invariant | Application | Database |
| --- | --- | --- |
| one assignment per booking / per hold | handler, `insertAssignment` | `UNIQUE (booking_id)`, `UNIQUE (hold_id)` |
| ≤ 1 live offer per assignment | `markOffered` (LIVE_OFFER_EXISTS) | partial `UNIQUE (assignment_id) WHERE status='OFFERED'` |
| ≤ 1 accepted offer per assignment | state machine | partial `UNIQUE (assignment_id) WHERE status='ACCEPTED'` |
| a resource never holds overlapping ASSIGNED jobs | — (two rows, two locks) | `EXCLUDE USING gist (resource_id =, tstzrange(starts_at, ends_at,'[)') &&) WHERE status='ASSIGNED'` → `RESOURCE_BUSY` |
| ASSIGNED ⇔ resource present; CANCELLED ⇔ reason | domain | CHECK constraints |
| status / reason domains | domain types | CHECK constraints |
| lost update | version read under `FOR UPDATE` | `UPDATE … WHERE version = $expected` |
| stale/out-of-order event never reopens a job | `decideHoldChange` | `hold_observation` watermark under per-hold advisory lock |
| one effect per event | inbox | `inbox_message` PK + payload hash, effect in the same transaction |
| one result per idempotency key | claim/complete in the command transaction | PK `(scope, idempotency_key)` |

Lock order everywhere: idempotency record → hold observation → assignment →
offer. READ COMMITTED with explicit row locks; a deadlock/serialization failure
re-runs the whole local transaction (bounded, jittered) and otherwise surfaces
as a retryable 503, never as success.

### Stale-worker / stale-offer fencing

- An offer that is not `OFFERED` can never be accepted (`OFFER_NOT_LIVE`);
  withdrawing, declining or expiring it is final.
- Expiry is decided by the injected clock on every command: accepting at
  `expiresAt` records the expiry (committed) and answers `OFFER_EXPIRED`.
  The worker only brings jobs back to UNASSIGNED promptly; it uses `SKIP
  LOCKED` and re-checks the deadline under the lock, so a stalled, killed or
  duplicate worker cannot double-expire.
- Operations commands carry `expectedRevision`; a stale view is `412`.
- A killed replica's open transaction holds row locks until PostgreSQL notices
  the dead socket. The runtime pool sets `idle_in_transaction_session_timeout`
  = 5 s so such sessions are ended server-side.

## Idempotency and replay

| Command | Key | Replay | Conflict |
| --- | --- | --- | --- |
| offer / reassign / unassign | `Idempotency-Key` (16–128 `[A-Za-z0-9_-]`), scope = actor + operation + assignment | same key + same canonical body → current state of the produced result, `200` | different body: `409 IDEMPOTENCY_CONFLICT` |
| accept / decline | same, scope = technician + operation + offer | same | same |
| hold-changed event | event id | identical bytes → DUPLICATE (no effect) | different bytes → CONFLICT → dead-letter |

A refused command (`REVISION_CONFLICT`, `OFFER_EXPIRED`, …) leaves no
idempotency record, so a retry is evaluated against the new state. Concurrent
requests with one key serialise on the record insert; exactly one executes.
Retention: 7 days (`IDEMPOTENCY_RETENTION_MS`), purged by the expiry worker in
bounded batches.

## Security and privacy

- Deny by default. Users via Identity's session view (`operations.dispatch`,
  `work.read:assigned`, `work.execute:assigned`); the service scope
  `dispatch.assignment.read` (interim digest credentials) reads by booking only.
- Object access: a technician acting on another technician's offer gets `404`.
- Technician view returns only their offer and the job window.
- Audit rows for offer created/accepted/declined/expired, unassign/reassign,
  job opened/cancelled and booking-conflict anomalies; opaque ids only.
- Events carry opaque ids; `data` has no technician subject.
- Error bodies: shared envelope, fixed messages, correlation and request ids;
  internals never reflected. Per-actor budget answers 429 with `retryAfterMs`.

## Migration

`services/dispatch/prisma/migrations/20261008100000_p02c3_assignments_offers`:
expand-only (extension `btree_gist`, seven new tables, constraints, indexes).
Nothing existing is altered or dropped. Applied by `cw_dispatch_migrate`;
runtime role has DML only and no access to `_prisma_migrations` (asserted by a
test). `prisma migrate diff` between the migrated database and `schema.prisma`
reports an empty migration (CHECK/EXCLUDE/partial indexes live in SQL only).

Rollback: redeploy the previous image; it does not use the new tables.
Dropping them is a separate reviewed contract step with a backup, not part of
this change. No data is migrated.

## Evidence

Produced by `node scripts/production/C/verify.mjs dispatch` on a clean tree;
exact commit, tree, images and counts are in the PR description.

| Family | Real dependency | Suites |
| --- | --- | --- |
| unit | none (pure + stubs) | `test/unit/domain.spec.ts`, `test/unit/edge-security.spec.ts` |
| postgres | PostgreSQL 16.10, runtime role, 2+ pools as replicas | `test/integration/dispatch.pg.spec.ts` |
| http | real Nest server + PostgreSQL; Identity HTTP double | `test/integration/http.pg.spec.ts` |
| contract | built `@carwash/contracts`, `@carwash/event-contracts` | `tests/production/C/dispatch-contract.test.mjs` |
| broker (inbox) | PostgreSQL + RabbitMQ 4.2 quorum queue + DLX, shared `InboxConsumer`, SIGKILLed child consumer | `tests/production/C/dispatch-inbox-rabbitmq.test.mjs` |
| broker (outbox) | PostgreSQL + RabbitMQ 4.2 + shared `OutboxRelay` | `tests/production/C/dispatch-outbox-rabbitmq.test.mjs` |
| restart | compiled API/worker processes, SIGKILL, `docker restart` of PostgreSQL | `tests/production/C/dispatch-restart.test.mjs` |

Defect found by these suites during development, and fixed: the accept/decline
unit of work read the offer through the connection pool while holding its own
transaction connection; with more concurrent technician commands than pool
connections (12 accepts in the SIGKILL suite) every request timed out (503).
The read now goes through the transaction (`readOffer`), and a regression test
(16 concurrent accepts on one pool) fails without the fix.

Not proven here: Identity token verification (Identity's own suites), a
deployed consumer/relay process (blocked on CR-P02-C3 §2), production broker
ACLs/topology, Workforce eligibility of the offered resource (CR-P02-C3 §5),
end-to-end flow with the real Scheduling producer (needs P02-C1 merged),
multi-node PostgreSQL failover, load beyond the concurrency tests above.

## Blockers (external to this child)

- CR-P02-C3 §1/§3: Lane E to publish `dispatch.assignment-changed.v1` and `dispatch.v1`.
- CR-P02-C3 §2: dependencies for the in-service consumer/relay processes.
- CR-P02-C3 §4: workload identity.
- CR-P02-C3 §5: Workforce eligibility and subject↔resource mapping.
- P02-C1: scheduling must emit `scheduling.hold-changed.v1`.
