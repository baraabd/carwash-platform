# P03-C1 — Workforce: published capacity resources, eligibility events, technician availability

Child of P03-C (Lane C: Dispatch and the real technician job execution). One
branch, one PR from `main@a14997a`; not stacked on any other child. The binding
cross-child interface is `P03-C-interfaces.md` § C1. Parent status remains
**INTEGRATION_PENDING** until all P03-C children pass together on one merge tree
and Lane E publishes the requested additions (`contract-requests/CR-P03-C1-workforce.md`).

## Responsibility boundary

Workforce owns the technician as a **capacity resource**: profile, employment,
suspension, verification projection, skills, shifts, eligibility, and now the
technician's own **availability** (ready/break). It answers *who can work where
and when* through the published `workforce.v1` `listCapacityResources`, and
announces eligibility changes through the published
`workforce.eligibility-changed.v1`.

It does not own assignments, offers or task execution (Dispatch), booking
state (Booking) or slots (Scheduling). Dispatch/Scheduling never read Workforce
tables; they call the HTTP contract or consume the event.

| Fact | Owner | Exposed as |
| --- | --- | --- |
| resource id | Workforce (`operator.id`) | `resourceId` |
| resource revision | Workforce (`operator.version`) | `revision` |
| eligibility revision | Workforce (`operator.eligibility_revision`, new) | `eligibilityRevision`, event `aggregate.version` |
| eligibility | derived: operational readiness at an instant | `eligibility` (query: at `from`; event: at the change) |
| working zones/windows | ACTIVE `work_shift` rows | `zoneIds`, `shifts` |
| ready/break | `operator_availability` (new) | `/me/availability` (requested, not published) |

## What was implemented

1. **`GET /internal/v1/workforce/capacity-resources?zoneId&from&to&limit&cursor`**
   (published `workforce.v1.listCapacityResources`), service scope
   `workforce.capacity.read` only (added to the service-client scope set);
   users and services without the scope get `403` **before** the query is read.
   - A resource is listed iff it has an ACTIVE shift in `zoneId` overlapping
     `[from, to)` (half-open: a shift ending at `from` or starting at `to` does
     not count). Resources without such a shift are omitted.
   - `eligibility` = `ELIGIBLE` iff operational readiness (active employment,
     not suspended, verification VERIFIED and valid at the instant, ≥ 1 skill)
     holds **at `from`**. A verification that expires before `from` yields
     `INELIGIBLE` even if the operator is ready now.
   - `zoneIds` = sorted distinct zones of the resource's ACTIVE shifts
     overlapping the window (all zones, not just `zoneId`); `shifts` = those
     shifts with their real bounds, sorted by start, never overlapping (DB
     exclusion constraint).
   - Bounds: the published parser allows at most 20 zones and 100 shifts per
     resource and no maximum window. When a very wide window exceeds them, the
     queried zone plus the first 19 other zones (sorted) and the first 100
     shifts (by start) are returned. Consumers needing more narrow the window.
   - Pagination: keyset on resource id, `limit` 1–100 (default 20), opaque
     cursor = base64url of `{v, s, a}` where `a` is the last resource id and
     `s` a 64-bit digest of `(zoneId, from, to)`. A cursor from another query,
     a modified or non-canonical cursor is `400 REQUEST_INVALID`, reason
     `INVALID_CURSOR`. `limit` may change between pages. Response
     `{items, nextCursor, asOf}` validates with the published
     `parsePage(…, parseCapacityResourceV1)`.
   - Query parsing mirrors `parseCapacityResourceQueryV1` + `parsePageRequest`
     exactly (proven by a parity test) and is stricter in one respect: unknown
     query parameters are refused (closed query).
2. **`workforce.eligibility-changed.v1` in the published shape** (envelope v2,
   producer `workforce`, aggregate `{type:'capacity-resource', id: operatorId,
   version: eligibilityRevision}`, data `{eligibility}`), written to the
   existing outbox in the **same transaction** as the change, exactly when the
   eligibility revision moves. The P01-C2 payload (operatorId, skills,
   verification status… under `schemaVersion: 1`) is gone; it never conformed.
3. **Technician availability** (requested, owned by Workforce):
   - `GET /internal/v1/workforce/me/availability` — user with `work.read:assigned`.
   - `PUT /internal/v1/workforce/me/availability` body exactly
     `{status:'AVAILABLE'|'ON_BREAK', expectedRevision}` — user with
     `work.execute:assigned`.
   - View exactly `{status, revision, updatedAt}`; never set →
     `{status:'ON_BREAK', revision:0, updatedAt:null}` (no row is stored).
   - No operator profile for the subject → `404 NOT_FOUND`, reason
     `OPERATOR_NOT_FOUND`. Services are always `403`.
   - Availability never changes the operator row, its version, eligibility,
     capacity listing or the outbox. It has no event.
4. **Shared error envelope.** Every workforce route (old and new) now answers
   with the published `ApiErrorEnvelope`
   (`{error:{code, reason, message, requestId, correlationId, retryable,
   retryAfterMs, issues}}`), fixed messages, domain code in `reason`. The
   filter is also global so malformed JSON and unknown routes use it too. This
   replaces the P01-C2 service-kit body (`{error:{code,message,correlationId,status}}`);
   no published consumer used it.

### Deviations from the interface text (explicit)

| Item | Interface text | Implemented | Why |
| --- | --- | --- | --- |
| Stale availability revision | `409 REVISION_CONFLICT` | `409`, `code: CONFLICT`, `reason: REVISION_CONFLICT` | the published envelope binds `code: REVISION_CONFLICT` to `412` (If-Match). 409 + reason keeps both the interface status and envelope validity. Lane E asked to confirm in CR §1. |
| `404 OPERATOR_NOT_FOUND` | as code | `code: NOT_FOUND`, `reason: OPERATOR_NOT_FOUND` | shared code set; reason requested for the owner allowlist |
| Query strictness | published parser | + unknown parameters refused | closed-input convention |
| `IDEMPOTENCY_KEY_REUSED` (P01-C2 routes) | was 422 | `409 IDEMPOTENCY_CONFLICT` | shared envelope mapping |

## Architecture

```
transport/http       WorkforceController (+capacity-resources, me/availability),
                     ActorResolver, WorkforceHttpFilter (shared envelope, also global)
     │
application          WorkforceService (+listCapacityResources, availability,
     │               setAvailability), capacity-cursor (opaque keyset cursor)
domain               operator (eligibilityRevision), capacity (query + projection),
     │               availability, events (envelope v2 eligibility event), readiness
ports                + readOperatorBySubject, lock/insert/updateAvailability,
                     findAvailability, listCapacityCandidates; scope workforce.capacity.read
infrastructure       PrismaWorkforceStore (raw SQL, row locks, one-statement capacity read)
```

`node scripts/check-layers.mjs` passes: domain/application/ports import no
Nest, Prisma or pg. Domain and application import only types and
`EVENT_PRODUCERS` from the published `@carwash/event-contracts` (already a
declared dependency). `@carwash/contracts` is not a dependency, so the query
and resource rules are restated locally and proven by parity tests.

## Invariants and where they are enforced

| Invariant | Application | Database |
| --- | --- | --- |
| eligibility revision moves with every eligibility-input change (employment, suspension, verification status/validity, skill grant/revoke) and never otherwise | domain `eligibilityInputChanged` (all four inputs), `recordSkillChange`; profile edits and no-ops don't call it | `CHECK (1 <= eligibility_revision <= version)` |
| one eligibility event per revision, same transaction | `appendEligibility(before, after)` emits iff the revision moved | outbox row in the same transaction; operator row locked `FOR UPDATE` |
| concurrent eligibility changes serialise, revisions gap-free | lock operator → version-guarded update | `UPDATE … WHERE version = $expected` |
| listed resources have an ACTIVE shift in the zone overlapping `[from,to)` | — | single SQL statement, `status='ACTIVE' AND starts_at < to AND ends_at > from` |
| shifts of a resource never overlap | projection asserts (fails loudly) | existing `EXCLUDE USING gist … WHERE status='ACTIVE'` |
| availability status domain | `parseAvailabilityCommand` | `CHECK (status IN ('AVAILABLE','ON_BREAK'))` |
| availability revision ≥ 1 when stored; 0 = never set | domain | `CHECK (version >= 1)` |
| availability belongs to an operator | subject → operator lookup | FK `operator_availability.operator_id → operator.id` (RESTRICT) |
| one winner per expected availability revision | revision check under `FOR UPDATE` | first write `INSERT … ON CONFLICT DO NOTHING` (PK); later `UPDATE … WHERE version = $expected` |
| runtime role cannot change schema | — | DML-only role (tested: DDL and `_prisma_migrations` → 42501) |

Not enforced by the database (documented): monotonicity of
`eligibility_revision` (application-only; a direct UPDATE by the runtime role
could lower it within the CHECK bounds).

## Migration

`services/workforce/prisma/migrations/20261009120000_p03c1_capacity_availability`

- Expand-only: `ALTER TABLE operator ADD COLUMN eligibility_revision INTEGER NOT
  NULL DEFAULT 1` + CHECK; `CREATE TABLE operator_availability` + CHECKs + FK.
  Nothing existing is altered in type, renamed or dropped. Existing rows get
  revision 1 (≤ their version).
- Mirrored in `schema.prisma`; CHECK constraints live in SQL only.
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
  against the migrated lane database (migration role) reports
  `-- This is an empty migration.`; `prisma migrate status`: up to date.
- Applied by `cw_workforce_migrate`; the runtime role receives DML through the
  provisioned default privileges and stays DML-only.
- Rollback: redeploy the previous image. It never reads the new column or
  table, and the column default keeps its inserts valid. Dropping them is a
  separate reviewed contract step with a backup. No data is migrated.

## Idempotency and concurrency

| Command | Mechanism | Replay / race outcome |
| --- | --- | --- |
| `PUT /me/availability` | `expectedRevision` (optimistic) under `FOR UPDATE`; first write races on the PK | exactly one of N concurrent writers with the same `expectedRevision` wins; the others get `409 CONFLICT/REVISION_CONFLICT`. A repeat of the winning request (same status, new revision) is a no-op `200` returning the current view. A stale revision is refused even if it asks for the current status. |
| eligibility-input commands (P01-C2) | operator row lock + version guard | gap-free revisions under concurrency (8 concurrent grants from two pools tested) |
| `GET capacity-resources` | read-only, one statement (one snapshot per page) | keyset paging: a resource added during paging appears iff it sorts after the cursor; no duplicates, no skips of existing resources |

The availability PUT carries no `Idempotency-Key`: the revision makes a retry
safe (a retry after a lost response either no-ops or reports the conflict).

## Security and privacy

- Deny by default. `listCapacityResources`: service scope
  `workforce.capacity.read` only (interim digest credentials, constant-time
  compare). Availability: users only, own subject only (`/me`), never a path
  parameter, so no object can be addressed across technicians.
- Authorization is checked before any input parsing or store access.
- Capacity resources carry no personal data (no subject, name, phone).
  The eligibility event data is `{eligibility}` only; the envelope actor is the
  acting account's opaque Identity subject (as envelope v2 defines).
- Availability audit row per committed change (`AVAILABILITY_CHANGED`, operator
  id, status, previous status, revision); no-ops are not audited.
- Logs carry error code, reason, status, correlation and request ids only.

## Evidence

Produced by `node scripts/production/C/verify.mjs workforce` on a clean tree;
exact commit, tree, images and counts are in the PR description / report.

| Family | Real dependency | Suites |
| --- | --- | --- |
| unit | none (pure + in-memory port fake) | `test/unit/eligibility-revision.spec.ts`, `capacity.spec.ts`, `availability.spec.ts`, `http-errors.spec.ts`, pre-existing `workforce.{authorization,domain,edge}.spec.ts` |
| postgres | PostgreSQL 16.10, runtime role, 2 pools as replicas | `test/integration/capacity.pg.spec.ts`, `availability.pg.spec.ts` |
| http | real Nest server + PostgreSQL; **Identity HTTP double**; real digest service credentials | `test/integration/http.pg.spec.ts` |
| contract | built `@carwash/contracts` + `@carwash/event-contracts`; compiled service; PostgreSQL | `tests/production/C/workforce-contract.test.mjs` |

`test/workforce.nest.spec.ts` (module wiring, live/ready 503) stays at the test
root as `check-layers` requires and is run separately (`node --test
dist-tests/test/workforce.nest.spec.js`), like the dispatch equivalent.

## Not proven here

- Identity token verification (Identity's own suites; a double is used).
- A running outbox relay / broker publication of the eligibility event: the
  relay dependency is still Lane E's (CR-C2); rows are proven valid, not
  delivered.
- Time-driven eligibility changes: a verification that expires produces **no
  event** (no input changed, the revision does not move). Consumers must
  re-read `listCapacityResources` for the job window (as P03-C § C4 requires
  before offer and acceptance). An expiry sweeper/event is not implemented.
- Production broker ACLs, workload identity, multi-node PostgreSQL, load beyond
  the concurrency tests, behaviour at > 100 shifts / > 20 zones in practice.
- That Dispatch actually consumes availability (C4 decides; CR §4).

## Blockers (external to this child)

- CR-P03-C1 §1: Lane E to add `getMyAvailability` / `setMyAvailability`,
  reasons `OPERATOR_NOT_FOUND`, `REVISION_CONFLICT`, `INVALID_CURSOR` and the
  409 decision to `workforce.v1`.
- CR-P03-C1 §2: grants of `workforce.capacity.read` to Scheduling and Dispatch
  (and the platform workload identity, still CR-C1 §4).
- CR-P03-C1 §3: subject → resource read for Dispatch (still a gap).
- CR-P03-C1 §4: availability exposure to Dispatch for new offers.
- Outbox relay dependency (CR-C2) before the event leaves the database.
