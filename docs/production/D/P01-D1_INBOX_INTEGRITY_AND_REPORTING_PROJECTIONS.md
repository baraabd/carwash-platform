# P01-D1: inbox integrity (INT-D-01) and Reporting projection primitives

Parent task: P01-D. Status of the parent: **INTEGRATION_PENDING**.
This child is reviewable on its own. It is not production-ready, not deployed,
and not a business projection of bookings or money.

## Scope

| Area | Change |
| --- | --- |
| `services/communications/src/inbox/prisma-inbox.store.ts` | INT-D-01 fix |
| `services/reporting/src/inbox/prisma-inbox.store.ts` | INT-D-01 fix (identical logic, service-local) |
| `services/reporting/src/{domain,application,ports,infrastructure}` | Projection primitives: contribution ledger, metric buckets, monotonic aggregate snapshots, reconciliation drift |
| `services/reporting/src/inbox/consumer.runner.ts` | The existing probe effect also projects, in the same inbox transaction |
| `services/reporting/prisma` | Schema plus migration `20261007090000_p01d_projection_primitives` |
| `tests/production/D`, `scripts/production/D` | Real PostgreSQL and RabbitMQ suites and their runner |

## INT-D-01: what was wrong and what changed

Before this change, both stores mapped **every** `P2002`/`23505` raised anywhere
in the inbox transaction to `DUPLICATE`, and the shared consumer ACKs a
`DUPLICATE`. That caused two defects:

1. **Integrity conflict hidden.** Two concurrent deliveries of one event ID with
   *different* bytes both read "absent". The loser hit the primary key and was
   reported as `DUPLICATE` (ACK) instead of `CONFLICT` (dead-letter).
2. **Work silently discarded.** A unique violation raised by the effect itself
   (an unrelated business constraint) rolled back the effect and was ACKed as a
   duplicate, so the event was never applied.

Now a unique violation is a duplicate only if a **committed** inbox row for the
same event ID exists after the failed transaction has rolled back. The store
reads the winner in a fresh statement and compares the byte hash:

| Committed winner | Outcome | Consumer action |
| --- | --- | --- |
| Same hash | `DUPLICATE` | ACK |
| Different hash | `CONFLICT` | dead-letter |
| None | throw `InboxEffectConflictError` | NACK and requeue; the quorum delivery limit then dead-letters it |

This decision does not depend on the error-object shape, and it stays correct
even when an unrelated violation coincides with a concurrent winner: the winner
proves the effect was applied.

## Reporting projection primitives

Reporting stores derived rows only. Every row names the source service and the
source event that produced it, and all rows can be rebuilt by replay.

- **`projection_contribution`**: one row per `(projection, source_service,
  source_event_id)`. This makes a backfill or replay unable to count a source
  event twice, independently of the inbox. A `contribution_hash` mismatch is an
  integrity error. The ledger is **append-only**: a `BEFORE UPDATE OR DELETE`
  trigger (`reporting_reject_mutation`, pinned `search_path`, no EXECUTE
  for PUBLIC) rejects rewrites for every role, including the owner. TRUNCATE
  stays denied because provisioning never grants it. An earlier ACL-only revoke
  was dropped: provisioning re-grants generic DML on every table on each
  replay, which both broke the replay-idempotency test and silently restored
  UPDATE/DELETE. The trigger is the same convention as Catalog's immutable tables.
- **`metric_bucket`**: an exact `BIGINT` per UTC day, folded with a native
  `INSERT … ON CONFLICT DO UPDATE` increment. `contribution_count` allows
  reconciliation.
- **`aggregate_snapshot`**: the latest state per source aggregate, keyed by the
  source owner's `aggregateVersion`. An older version is ignored as `STALE`. The
  same version with different content is `SNAPSHOT_VERSION_CONFLICT`. The state
  is a flat record of at most 24 non-personal scalars.
- **Drift query**: compares each bucket with its ledger fold inside one
  repeatable-read snapshot.

The only runtime producer stream with an accepted contract and broker topology
today is Catalog's non-financial `foundation.probe.created.v1`, so that is what
drives the primitives end to end. No booking, payment or customer projection is
implemented or implied (see CR-D-P01-04).

## Migration

`services/reporting/prisma/migrations/20261007090000_p01d_projection_primitives`:
additive only (the expand step). It creates 3 tables with CHECK constraints and
an append-only ledger trigger, and changes no existing object. Rollback: deploy the
previous worker build, which ignores the new tables. Dropping them is a separate
reviewed contract step, and nothing depends on it. The runner proves zero drift
between the replayed migrations and `schema.prisma`.

## Evidence

Fill-in rule: every number below comes from a command run on this branch's
exact tree. See the PR body for base/head/tree.

| Family | Command | Result |
| --- | --- | --- |
| Domain/unit | `node --test services/reporting/dist-tests/test/*.spec.js services/communications/dist-tests/test/*.spec.js` | see PR |
| Real PostgreSQL + RabbitMQ | `node scripts/production/D/run-real-infra.mjs --suite inbox` and `--suite reporting` | see PR |
| Negative control | The same inbox suite against `origin/main`'s store | 2 failures, as expected (see PR) |
| Existing foundation gate | `node scripts/acceptance.mjs --run` (fresh ephemeral stack) | see PR |
| Guards | layers, boundaries, append-only migrations (`--base-ref origin/main`), design reference, prettier, eslint | see PR |

Real versus mocked dependencies: PostgreSQL 16.10 and RabbitMQ 4.2 are real
ephemeral containers. The publisher in B1 is the real Catalog broker identity
publishing to the real exchange. Nothing is mocked in these suites.

## Not covered and still pending

- No business event contracts or topology for Booking, Billing or Workforce
  exist (CR-D-P01-04), so business projections cannot be built yet.
- There is no Reporting HTTP read API: permissions and a gateway route are
  pending (CR-D-P01-01, CR-D-P01-05).
- The local day is UTC only. A business-timezone day is an explicit future
  policy decision.
- The single-node broker is not HA, and nothing here is production evidence.
