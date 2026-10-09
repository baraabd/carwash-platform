# P02-C2 — Durable Booking coordinator (aggregate, snapshots, creation saga)

Child of P02-C. Base: `main` at `566d2e7435dac0803d075556fff43c435f8a29a7`
(tree `1bd162f2578878643b3e2c2cc437fece36716588`). Independent of the sibling
children (C1 Scheduling v1 conformance, C3 Dispatch); nothing here is stacked on
an unmerged branch. Booking consumes only PUBLISHED contracts (pricing.v1,
scheduling.v1, vehicle.v1, customer.v1, envelope v2) and the REQUESTED ones of
`contract-requests/CR-P02-C2-booking-v1.md`, which are marked as such everywhere.

## Responsibility boundary

Booking owns the booking lifecycle and its immutable snapshots. It does not own
the customer, vehicle, address, catalog, price, capacity, money or technician
records: those stay with their owners and are referenced by id and revision.
No technician, offer or assignment data is stored in Booking (that is Dispatch,
C3). Payment truth is Billing's: Booking records the customer's chosen method
and requires an obligation before confirming, nothing more.

## Architecture

```
transport/http   BookingController, ActorResolver, BookingHttpFilter (platform error envelope)
      │
application      BookingService (create/get), BookingProcessManager (saga executor),
      │          authorization, command parsing, canonical fingerprint
domain           booking aggregate, lifecycle, snapshots, money (bigint), saga state machine,
      │          booking.created.v1 builder — pure, no I/O
ports            BookingStore, QuoteReader/Validator, HoldReader/Committer,
      │          Vehicle/AddressSnapshots, BillingObligations, Clock, Random, Observer
infrastructure   PrismaBookingStore (raw SQL, fenced leases), PrismaOutboxStore,
                 OwnerHttpClient (timeout + circuit breaker), owner adapters,
                 contract ACL parsers, IdentitySessionClient, composition
workers          saga.main (process manager worker, any number of replicas)
```

`scripts/check-layers.mjs` passes: domain, application and ports import no Nest,
Prisma, pg, HTTP or broker code.

## Aggregate and snapshots

A booking is created `PENDING_CONFIRMATION` with these immutable snapshots:

| Snapshot | Source | Notes |
| --- | --- | --- |
| contact | request (screen 5 "بياناتك") | name, E.164 phone, optional notes — personal data, never evented/logged |
| vehicle | vehicle.v1 `resolveVehicleSnapshot` or inline one-time vehicle | plate stays optional (approved journey) |
| address / service area | customer.v1 `resolveAddressSnapshot`; zone from the hold | owner id + revision kept |
| catalog selections + quote | pricing.v1 `getQuote` (on behalf of the principal) | full lines (definition ids, quantities, exact money), catalog/price-book revisions |
| slot | scheduling.v1 `getHold` (on behalf), then the committed hold | requested slot at creation; committed slot set at confirmation and must equal it |

Cross-snapshot invariants before anything is persisted: the quote belongs to the
principal, was priced for the same vehicle type and (if zoned) the same zone as
the hold, and the slot has not started. A trigger refuses any UPDATE of a
snapshot column, any version jump other than +1, and any DELETE.

Statuses: `PENDING_CONFIRMATION → CONFIRMED | REJECTED` (plus the existing
execution lifecycle after CONFIRMED). `REJECTED` is new and terminal: the saga
failed before its pivot and nothing was reserved.

## Creation saga (process manager)

Durable state lives in `booking_saga`; any replica can resume any saga.

| # | Step | Owner call | Idempotency | Definitive failure | Unknown / unavailable |
| --- | --- | --- | --- | --- | --- |
| 0 | capture (in request) | getQuote, getHold (on behalf); vehicle/address snapshot resolve | safe reads | 4xx answer → 422 to the client, nothing persisted, key released | 503 to the client, nothing persisted, key released |
| 1 | persist | local tx: booking + saga + key binding + audit | `Idempotency-Key` claim, partial unique hold/quote | `HOLD_ALREADY_BOOKED` / `QUOTE_ALREADY_BOOKED` 422 | rolled back, retry |
| 2 | VALIDATE_QUOTE | pricing.v1 validateQuote (service, safe) | safe | REJECTED (`QUOTE_EXPIRED`/`QUOTE_REVOKED`/`QUOTE_INVALID`, incl. total ≠ snapshot) | retry with backoff until the deadline, then REJECTED `DEADLINE_EXCEEDED` |
| 3 | CREATE_OBLIGATION | billing (requested) create | key `booking-obligation-<bookingId>` | REJECTED `OBLIGATION_REJECTED` (nothing exists) | retry until the deadline; then **void** (it may exist) and REJECTED `DEADLINE_EXCEEDED` |
| 4 | COMMIT_HOLD (**pivot**) | scheduling.v1 commitHold (service) | key `booking-commit-<bookingId>`; replay by bookingId returns the committed hold | refused (`HOLD_EXPIRED`, not active, revision) → **void obligation** → REJECTED | `pivotAttempted` is persisted before the call; replay the same commit forever (capped backoff), never reject on time |
| 5 | finish | local tx: booking CONFIRMED + `booking.created.v1` outbox + audit | fenced by lease; booking version-guarded | committed slot ≠ requested → `NEEDS_RECONCILIATION` (not confirmed, audited) | tx rolled back, step replays (commit replay is idempotent) |
| — | VOID_OBLIGATION | billing (requested) void-for-booking | key `booking-void-<bookingId>`, tombstone | — | retry forever (compensation must finish) |

Why the pivot is last: scheduling.v1 gives Booking no route to undo a commit
(confirmed by C1: only an audited staff override exists). So every compensable
step runs before it, and everything after it only moves forward. The task text
lists Billing after Scheduling; the order was swapped for exactly this reason.
Dispatch (C3) relies on it: a COMMITTED `scheduling.hold-changed.v1` therefore
means a booking that will be CONFIRMED.

Response loss is handled at every boundary: the step that lost its answer is
re-run with the same key/booking id, and each owner's idempotency turns the
re-run into a replay of the first effect.

The deadline (10 minutes, the scheduling.v1 hold lifetime) bounds only the
pre-pivot steps. Inline, the API drives the saga for up to
`BOOKING_INLINE_SAGA_BUDGET_MS` so the customer usually gets the final answer;
otherwise the response says `confirmation: PENDING` and the worker finishes.

## Exactly one logical booking

| Threat | Mechanism | Proof (real PostgreSQL) |
| --- | --- | --- |
| duplicate confirmation, same key | `booking_request` claim row (PK principal+key), fenced takeover after a crash | 12 concurrent requests on 3 replicas → 1 booking, 1 commit, 1 event; 20 concurrent HTTP requests on 2 OS processes → 1 booking |
| duplicate confirmation, different keys | partial unique `booking_live_hold_key` / `booking_live_quote_key` | 8 concurrent requests → 1 live booking, rest 422 |
| stale quote | capture checks status + revision; saga re-validates and compares totals | expired at capture → nothing persisted; expired at confirmation → REJECTED, no commit |
| stale hold | capture checks HELD + revision + beneficiary; commit refusal → void → REJECTED | revision changed → refused; expired before commit → void + REJECTED |
| crash after persist | durable saga + lease; worker resumes after lease expiry | crashed lease respected, then resumed; stale owner fenced off |
| crash during the pivot | `pivot_attempted` persisted first; commit replay | API SIGKILLed with the commit applied but unanswered → worker replays → CONFIRMED, commit applied once |
| two workers | `FOR UPDATE SKIP LOCKED` lease + fence on every write | concurrent workers on one saga → one finish, one event; 2 passes over 6 sagas → each once |
| database restart | stateless processes, fenced re-lease | `docker restart` of PostgreSQL mid-saga + SIGKILLed worker → finished once |

## Idempotency and replay policy

| Command | Key | Replay | Conflict |
| --- | --- | --- | --- |
| create booking | `Idempotency-Key` header (`[A-Za-z0-9_-]{16,128}`), scope = principal (kind+subject) | same key + same canonical body: the same booking, 200 | different body: 409 `IDEMPOTENCY_CONFLICT`; concurrent in flight: 409 `IDEMPOTENCY_IN_PROGRESS` (retryable) |

Fingerprint = SHA-256 of the canonical (sorted keys, NFC) parsed business body;
headers, correlation ids and credentials are not part of it. Failures are not
cached: a refused or unavailable capture releases the key. Retention: a bound
key lives as long as its booking (bookings are never deleted); deciding a
shorter retention is an owner/product decision recorded in CR-P02-C2 §6.

## Security and privacy

- Deny by default. Principals (account or guest) are resolved by Identity's
  session view; a session without `principalKind` is refused, never assumed.
  Create needs `bookings.create:self`; read needs `bookings.read:self` on one's
  own booking (another principal's booking is 404) or `operations.dispatch`.
  Service credentials are refused on Booking's own API.
- Outbound: per-owner interim service credentials (`BOOKING_TOKEN_<OWNER>`), so a
  credential leaked from one owner cannot be replayed at another. The caller's
  bearer is used only for read-only on-behalf reads of their own quote and hold
  during their own request; it is never stored, evented or logged
  (`UserCredential` serialises as `[redacted]`).
- Events, audit rows and logs carry opaque ids, codes and counts only. Tests
  assert the outbox payload contains no name, phone, address text or plate.
- Errors use the platform envelope; internal text is never reflected.
- Per-principal request budget (process-local) answers 429.
- The runtime role has DML only: it cannot alter/disable the guards, create
  objects or read `_prisma_migrations` (tested).

## Resilience and observability

- Every owner call: explicit timeout, per-owner circuit breaker (fail fast, one
  half-open probe), bounded response size. A timeout is never success: reads are
  UNAVAILABLE, the pivot is UNKNOWN and replayed.
- Saga retries: exponential backoff with full jitter (injected random), capped
  at 30 s before and 5 min after the pivot.
- Correlation id of the creating request is stored with the saga and sent on
  every owner call, the outbox row and the broker message; the W3C trace parent
  of the active span is propagated. Structured redacted logs per saga step.
- Business metrics: the shared metrics registry has no generic business counter
  (Lane E owned); saga steps are diagnosable from logs, `booking_saga` and audit.

## Migration

`services/booking/prisma/migrations/20261008100000_p02c2_booking_saga`:
expand-only (5 new tables, CHECK constraints, partial unique indexes, one
trigger function with two triggers). Nothing existing is altered or dropped.
Applied by `cw_booking_migrate`; the runtime role has DML only.
`prisma migrate diff` between the migrated database and `schema.prisma` is empty.

Rollback: redeploy the previous image; it does not read the new tables. Dropping
them is a separate reviewed contract step with a backup, not part of this change.

## Evidence

`node scripts/production/C/verify.mjs booking` on a clean tree; the exact head,
tree, image digests and counts are in the PR description.

| Family | Real dependency | Suites |
| --- | --- | --- |
| unit | none (pure + real local HTTP servers) | `test/unit/domain.spec.ts`, `test/unit/adapters.spec.ts` |
| postgres | PostgreSQL 16.10, runtime role, several pools as replicas | `test/integration/saga.pg.spec.ts`, `store.pg.spec.ts` |
| http | real Nest server + PostgreSQL + real HTTP adapters; owners and Identity as one HTTP double | `test/integration/http.pg.spec.ts` |
| lane | compiled processes, SIGKILL, `docker restart` PostgreSQL, RabbitMQ 4.2 + shared OutboxRelay, published-parser parity | `tests/production/C/booking-*.test.mjs` |
| existing | generated Nest runtime spec | `test/booking.nest.spec.ts` |

Owner services are doubles in every suite (in-process port doubles for the saga
suites, one HTTP double for the HTTP and process suites). Their behaviour follows
the published contracts and, for Scheduling, the commit semantics delivered by
C1; `booking-contract-parity` proves the documents they emit are accepted by the
published parsers. A real cross-service run needs C1 merged, Pricing/Customer/
Vehicle providers conforming to their contracts, and a Billing contract.

Defects found by these suites and fixed during development:
- the saga/booking join returned the saga's `version`/`updated_at` for the
  booking (same column names), so a finishing transaction compared the wrong
  version and failed; columns are now aliased.
- `assertCanRead` answered 404 to a caller without any read permission; it now
  answers 403 and keeps 404 for another principal's booking.

## Not proven here / blockers

See `contract-requests/CR-P02-C2-booking-v1.md`. In short: Billing has no
published contract (every booking is rejected before its pivot in a real
deployment until it has one); Booking's own HTTP contract and
`booking.created.v1` are requested, not published; no relay process (dependency);
interim service credentials; Pricing's `validateQuote`/`getQuote` and the
Customer/Vehicle snapshot routes are not yet implemented by their owners per
contract; no Geo serviceability check of the address against the hold's zone
(Geo has no zone data); guest/account `booking.confirmed.v1` (needs
`customerId`) is not emitted. `BUSINESS_READY` stays `false`.
