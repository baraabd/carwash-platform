# P03-D1: Reporting live-operations projections and KPIs

Parent task: P03-D, "admin live operations and cash finance operations".
Parent status: **INTEGRATION_PENDING**.

This child is the Reporting provider half of P03-D. It also carries the P02-D1
operations projections (commit `feat(reporting): operations projections and
read API (P02-D1)`). That work was finished on a local branch but was never
pushed or reviewed, and P03-D builds on it. Its design is unchanged and is
documented in `P02-D1_REPORTING_OPERATIONS_PROJECTIONS.md`.

This child is not production-ready and not deployed. No live producer feeds it
on the accepted topology (CR-D-P02-03, CR-D-P03-01).

## Scope

| Path | Change |
| --- | --- |
| `services/reporting/src/domain/operations.ts` | Adds Dispatch assignment and Billing obligation facts, `dispatch`/`billing` sources, and new integrity codes |
| `services/reporting/src/domain/live-operations.ts` | Pure rules: validated fact builders, exact amounts, order-independent milestones, nearest-rank percentiles, partial-source detection |
| `services/reporting/src/application/operations.service.ts` | Projector routes the new facts; `operationsKpis` and `cashKpis` queries; booking detail lists assignments |
| `services/reporting/src/application/access.ts` | `operationsKpis` uses `operations.dispatch`; `cashKpis` uses `billing.read`; `freshness` also accepts `billing.read` |
| `services/reporting/src/ports/operations.ports.ts` | Writer and reader ports for assignments, obligations and KPIs |
| `services/reporting/src/infrastructure/persistence/prisma-operations.store.ts` | Transaction-bound writer (one advisory lock per aggregate) and SQL aggregates |
| `services/reporting/src/transport/http/operations.controller.ts` | `GET kpis/operations`, `GET kpis/cash`; `assignments` added to booking detail |
| `services/reporting/prisma/migrations/20261009120000_p03d_live_operations_projections` | Additive migration |
| `services/reporting/test/live-operations.domain.spec.ts` | Unit tests |
| `tests/production/D/reporting-live-operations.test.mjs` | Real PostgreSQL and real Identity suites L1-L9 and H1 |
| `tests/production/D/reporting-operations.test.mjs` | A7 now uses an unknown source (`payments`), because `billing` is now a valid source |

No shared package, lockfile, Gateway, CI or another lane's service is changed.

## What the projection holds

Reporting never decides an assignment or a financial fact. Dispatch owns
assignments, and Billing owns obligations and their reconciliation.

| Table | Key | Fact |
| --- | --- | --- |
| `ops_assignment` | assignment | Current status, resource and job window by Dispatch's version, plus first-occurrence milestones |
| `ops_assignment_resource` | assignment, resource | Every capacity resource the job was ever ASSIGNED to; two or more rows means it was reassigned |
| `ops_obligation` | obligation | Current Billing financial status, the exact outstanding amount (minor units, currency, scale), and `state_since` |
| `ops_freshness` | source | Now also counts `dispatch` and `billing` |

There are no names, phones, addresses, plates, provider references or receipts.

### Rules (pure domain, unit-tested)

- **Facts are validated before they are folded.**
  - A resource is named exactly when the status is `ASSIGNED`.
  - The job window is non-empty.
  - Ids are UUIDs, and versions are positive integers.
  - A `PAID` or `VOIDED` obligation has nothing outstanding.
  - An amount is an integer string with at most 18 digits. Its currency is
    `[A-Z]{3}` and its scale is 0-4. No float is ever involved.
- **Current state is monotonic in the owner's version.** This uses the same
  `decideFact` rule as P02-D1: newer applies, older is `STALE`, and the same
  version with the same content is `SAME`. The same version with different
  content throws `FACT_VERSION_CONFLICT`.
- **Milestones are independent of delivery order.** `first_observed_at`,
  `first_offered_at` and `first_assigned_at` are each the earliest source
  occurrence seen for that status. A stale delivery cannot change the current
  state, but it is a true past occurrence, so it can move a milestone earlier
  and add to the reassignment set. Suite L1 covers three delivery orders, and
  L3 covers a reassignment that arrives before the original acceptance.
- **An assignment belongs to one booking** (`ASSIGNMENT_BOOKING_CONFLICT`).
  **An obligation keeps one currency** (`OBLIGATION_CURRENCY_CONFLICT`). Both
  are integrity errors: the delivery is never ACKed as a duplicate.
- **`state_since`** keeps the time the obligation entered its current state.
  It moves only when the state changes (L8). This makes the cash and review
  backlog age come from Billing's own times.
- **Percentiles are nearest-rank**, which is exactly PostgreSQL's
  `percentile_disc`. L6 checks the SQL aggregate value-for-value against the
  pure reference `summarizeDurations`.
- **A KPI names its partial sources.** Any source it depends on that is not
  `FRESH` is listed in `incompleteSources`. A quiet or broken pipeline therefore
  makes the figure visibly partial, never silently low.

### Concurrency and transactions

One delivery is one local transaction: the inbox row, the derived rows and
the freshness checkpoint commit together. Each new aggregate takes a single
transaction-scoped advisory lock (`ops-assignment:*` or `ops-obligation:*`).
It never nests with the hold or booking locks, so the existing lock order
cannot form a cycle. L4 runs eight deliveries of one assignment concurrently.
They converge on the highest version, with the earliest milestones and one
resource row.

### Database-enforced invariants (migration `20261009120000_p03d_live_operations_projections`)

The migration is additive (expand only):

- three tables, four indexes and one foreign key (cascade from assignment to
  resource);
- CHECK constraints for:
  - the closed status and cash-state vocabularies;
  - resource exactly when assigned;
  - a positive version;
  - a non-empty window;
  - ordered milestones;
  - an assigned row has an assignment milestone;
  - outstanding is non-negative, inside BIGINT, and zero when the obligation
    is closed;
  - currency code and scale;
  - `state_since <= occurred_at`.

The `ops_freshness_source_known` CHECK is dropped and re-added in the same
migration with a **wider** vocabulary. Every row that was valid before stays
valid, and the previous code never writes the new values. The runtime
identity still holds DML only (L5: TRUNCATE, ALTER and DROP are refused with
`42501`).

**Rollback:** redeploy the previous image. It never reads the new tables. Dropping them
is a separate, reviewed contract step and is not needed to roll back code.

## Read API (`reporting.operations`, served by Reporting)

| Route | Permission | Response |
| --- | --- | --- |
| `GET kpis/operations?from&to[&zoneId]` | `operations.dispatch` | The fields below |
| `GET kpis/cash` | `billing.read` | The fields below |
| `GET bookings/:bookingId` | `operations.dispatch` | Adds `assignments[]` with milestones and a `reassigned` flag |
| `GET freshness` | `operations.dispatch`, `verification.review` or `billing.read` | Freshness of all five sources |

`GET kpis/operations` returns:

- `derived` and `authority` (Dispatch, Booking, Scheduling);
- `freshness` for the booking, scheduling and dispatch sources;
- `incompleteSources` and `window`;
- `bookings.byDerivedStatus`;
- `assignments`, with these fields:
  - `byStatus`;
  - `reassigned`;
  - `assignedAfterStart`;
  - `timeToFirstOffer`, `timeToAssign` and `offerToAssign`, each as
    `{count, p50Ms, p90Ms, maxMs}`;
- `fieldStages: {available: false, reason: "NO_PUBLISHED_SOURCE"}`.

`GET kpis/cash` returns:

- `derived` and `authority` (Billing);
- `freshness` for the billing source;
- `incompleteSources` and `asOf`;
- `states[]`: `{cashState, count, outstanding[{currency, amountMinor: "<decimal string>", scale}], oldestSince}`.

The window is at most 31 days, the same rule as the booking list. Amounts are
summed by PostgreSQL as NUMERIC and returned as decimal strings. L7 sums
2 × (2^53 + 1) exactly.

The cash KPI is the **current** backlog, not a window. It covers every
obligation Reporting has seen, by Billing state. Operations staff cannot see
amounts. Finance staff cannot see booking operations. `super-admin` holds every
Identity permission and can read both (H1).

### Job stages

Dispatch publishes only `UNASSIGNED | OFFERED | ASSIGNED | CANCELLED`. No owner
publishes field progress (en route, arrived, washing or completed), so
Reporting cannot produce stage KPIs. The response says so instead of inferring
stages from time (CR-D-P03-03).

## Evidence

Command (exact final tree; acceptance stack from
`node scripts/dev/acceptance-infra.mjs up`):

```
pnpm generate && pnpm build
node scripts/production/D/run-real-infra.mjs --evidence docs/production/D/evidence/p03-d1-real-infra.json
```

| Dependency | Real? |
| --- | --- |
| PostgreSQL 16, with runtime and migration identities, privilege hardening, and a migration-replay drift check | real |
| Identity: Argon2, RS256, sessions, and roles granted through its own endpoint | real; OTP delivery is captured in-process |
| RabbitMQ 4 | real for the P01/P02 consumer suites; **not used** for the P03 facts (see below) |
| Dispatch and Billing producers | **not real**: the facts are built with the domain builders and applied through the projector inside one transaction, exactly as the inbox transaction does |

The suites in `tests/production/D/reporting-live-operations.test.mjs`:

- **L1-L4:** delivery-order independence, replay and conflict handling,
  rollback of refused deliveries, the reassignment set learned from stale
  facts, and concurrency.
- **L5:** CHECK, foreign key and privilege refusals.
- **L6:** window and zone KPIs against the nearest-rank reference.
- **L7-L8:** exact cash sums, a stale revision that does not reopen a paid
  obligation, the currency conflict, and `state_since`.
- **L9:** freshness for dispatch and billing.
- **H1:** operations, finance, super-admin and customer roles through the real
  HTTP adapter and the real Identity, including every denial and 401/422.

Unit tests: `services/reporting/test/live-operations.domain.spec.ts` (12 tests), plus
the existing suites. Unit totals and the gate result are recorded in the
evidence JSON.

## Not proven here (blockers)

- **CR-D-P03-01 (Lane E):**
  - `dispatch.assignment-changed.v1`, `billing.obligation-created.v1` and
    `billing.obligation-status-changed.v1` are not published in
    `@carwash/event-contracts`.
  - No broker topology exists for `dispatch.events` or
    `washgo.billing.events`.
  - Reporting therefore has no parser for them, and the consumer dead-letters
    them as `UNSUPPORTED_EVENT`. The mapping is in the contract request.
- **CR-D-P03-02 (Lane E):** Gateway routes for the two KPI reads (and the
  P02 routes, CR-D-P02-01).
- **CR-D-P03-03 (Dispatch owner):** a field-progress fact for job stages.
- **CR-D-P03-04 (Billing owner):** `bookingId` on obligation events. Without
  it, cash states cannot be joined to bookings, so the KPI reports the cash
  backlog per obligation only.
- No HA broker, no production database, and no load test beyond the bounded
  concurrency cases.

## Next consumer

P03-D3, the admin console. It reads these routes through the requested Gateway
routes and never imports this service.
