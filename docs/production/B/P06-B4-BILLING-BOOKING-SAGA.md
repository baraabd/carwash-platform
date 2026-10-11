# P06-B4 — Billing booking-saga obligation routes (billing.v1)

Parent: P06-B (Lane B, Commerce & Finance). Parent status: **INTEGRATION_PENDING**.
This child is not production-ready, not deployed and not integrated with a
running Booking service. No money flow is enabled.

## Why

`packages/contracts/src/billing/v1.ts` (billing.v1, published by Lane E in
P04-E1) declares two booking-saga routes with access
`service:billing.obligation.write`:

| Route | Contract name | Body |
| ----- | ------------- | ---- |
| `POST /internal/v1/billing/booking-obligations` | `createBookingObligation` | `CreateBookingObligationRequestV1` `{ beneficiary, quoteId, bookingId }` |
| `POST /internal/v1/billing/booking-obligations/:obligationId/void` | `voidBookingObligation` | `VoidObligationRequestV1` `{ expectedRevision }` |

Neither main nor the open P04-B1 PR (#125) served them. The Booking saga
therefore had no published, workload-authorized way to create or compensate
an obligation. Both routes now exist and respond with `ObligationV1`.

## Source

| Item | Value |
| ---- | ----- |
| Base (main) | `66aa7528500a06f65a4b73305506feee7c3fc3b3`, tree `3a2203e360a534dc3f98529717a7625257aaccd0` |
| Branch | `prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b4-billing-booking-saga` |
| Head / tree | Named in the PR and in `evidence/billing-postgres-<sha12>.json` (the evidence records the exact SHA/tree it ran on) |
| Contract | `billing.v1` (`@carwash/contracts`), events `billing.obligation-created.v1`, `billing.obligation-status-changed.v1` (unchanged) |
| Upstream contract | `pricing.v1` `validateQuote` (`service:pricing.quote.validate`, purpose `booking-create`) |
| Migration | `20261011100000_p06b4_booking_obligations` (expand-only) |

### Changed paths

- `services/billing/prisma/migrations/20261011100000_p06b4_booking_obligations/migration.sql` (new)
- `services/billing/prisma/schema.prisma` (mirror: `BookingObligation` model plus the back relation)
- `services/billing/src/ports/booking-obligation.ports.ts` (new), `ports/billing.ports.ts`, `ports/index.ts`
- `services/billing/src/application/booking-obligation.service.ts` (new), `application/index.ts`
- `services/billing/src/application/billing.service.ts` (customer void refuses a booking obligation)
- `services/billing/src/infrastructure/persistence/prisma-booking-link.store.ts` (new), `prisma-billing.repository.ts`
- `services/billing/src/infrastructure/pricing/pricing-quote.validator.ts` (new)
- `services/billing/src/infrastructure/security/service-callers.ts` (new)
- `services/billing/src/transport/http/booking-obligation.controller.ts` (new), `src/app.module.ts`
- `services/billing/test/billing.booking-saga.spec.ts`, `test/integration/billing.booking-saga.postgres.spec.ts`, `test/support/booking-saga-harness.ts` (new)
- `scripts/production/B/postgres-acceptance.mjs` (billing baseline and sentinel role)

## Behaviour

### Authorization (deny by default)

- The caller is a **workload**. It sends `x-service-client` and `x-service-token`,
  verified through `@carwash/service-kit` service clients.
  `BILLING_SERVICE_CLIENTS` holds SHA-256 digests only.
- Unset or empty configuration means no workload may call: every request gets
  401. Malformed configuration, or a scope Billing does not define, fails at
  startup.
- These responses are returned:

  | Condition | Status |
  | --------- | ------ |
  | Missing, unknown or wrong credential | 401 `AUTH_REQUIRED` |
  | Valid workload without the scope | 403 `AUTH_FORBIDDEN` |
  | Any request that also carries an `Authorization` header | 401 (a person's token is never accepted here, and an ambiguous identity is refused) |

- Customer routes stay principal-only. A workload credential on them is 401.

### Create

1. Input is the closed contract body. The obligation owner is the booking's
   **beneficiary**, never the workload.
2. If the same `Idempotency-Key` was already used, the stored response is
   replayed. If the key was used with a different body, the answer is 409
   `IDEMPOTENCY_CONFLICT`. The fingerprint covers the workload id, beneficiary,
   quote and booking.
3. If the booking already has an obligation with the same quote, beneficiary
   and workload, it is returned with 200. **Pricing is not called again**, so
   a saga retry still succeeds after the quote expired. Any other combination
   for that booking is 409 `OBLIGATION_ALREADY_EXISTS`.
4. A quote that already has an obligation (customer route or another booking)
   is 409 `OBLIGATION_ALREADY_EXISTS`. It is never adopted.
5. Billing calls Pricing `validateQuote` on its own workload credential, with
   `BILLING_PRICING_CLIENT_ID` (default `billing`) and the secret
   `BILLING_PRICING_SERVICE_TOKEN[_FILE]`.
   - The request says purpose `booking-create` and names the beneficiary.
   - 404, 422 or any negative reason is 409 `QUOTE_NOT_USABLE`.
   - An outage, timeout, refused Billing credential, malformed body or missing
     configuration is 503 `UPSTREAM_UNAVAILABLE`.
   - A client amount is never accepted.
6. One local transaction writes all of these together:
   - the obligation (`OPEN`, revision 1);
   - the `OBLIGATION_BILLED` journal (a receivable only);
   - the booking link;
   - the audit row (actor = beneficiary on whose behalf the workload acted);
   - the outbox `billing.obligation-created.v1`;
   - the idempotency receipt.
7. The result is 201 `ObligationV1`.

### Void (compensation)

- Only the workload that created the booking's obligation may void it. For any
  other caller, for a customer-created obligation and for an unknown id the
  answer is 404.
- The revision is checked with compare-and-set. A stale revision is 412.
- Void follows the domain `planVoid` rule: the obligation must be OPEN, with no
  payment attempt and nothing verified. Otherwise the answer is 409
  `VOID_NOT_ALLOWED`. An already voided obligation is 409 `OBLIGATION_VOIDED`.
- One transaction writes all of these together:
  - the active intent becomes CANCELLED;
  - the `OBLIGATION_VOIDED` journal;
  - the obligation becomes `VOIDED`;
  - the link void stamp;
  - the audit row;
  - the outbox `billing.obligation-status-changed.v1`;
  - the receipt.
- The customer route `POST /obligations/:id/void` now answers 409
  `VOID_NOT_ALLOWED` for a booking obligation. The booking owns that
  lifecycle; the customer cancels the booking instead. There is no regression,
  because no booking obligation existed before this change.

### Database guards (migration 20261011100000)

- `booking_obligation`:
  - primary key `booking_id`;
  - `obligation_id` is unique and has a RESTRICT foreign key;
  - the client id format is checked;
  - the void facts must be both set or both null.
- The insert guard allows a link only to an obligation inserted in the **same
  transaction**, OPEN, at revision 1. A committed obligation can never be
  adopted later.
- The update guard rejects every field change except a single void stamp. The
  stamp is allowed only when the obligation is already `VOIDED`.
- DELETE and TRUNCATE are rejected (`billing_reject_mutation`).

### Runtime write defect repaired

Main commit `5503125` revoked PUBLIC EXECUTE on the `billing_assert_*` helpers.
The COMMIT-time constraint triggers PERFORM those helpers, so **every runtime
obligation write on main failed** with "permission denied". This migration
makes these four caller functions `SECURITY DEFINER`:

- `billing_check_obligation_ledger`
- `billing_check_custody_holder`
- `billing_check_handover`
- `billing_check_journal_effects`

Their bodies are unchanged and their `search_path` stays pinned to
`pg_catalog, pg_temp`. EXECUTE stays revoked from PUBLIC. The open P04-B1
migration applies the same end state, so both merge orders converge.

## Evidence

### Real PostgreSQL

Command: `node scripts/production/B/postgres-acceptance.mjs --service billing --record`

The evidence file `docs/production/B/evidence/billing-postgres-<sha12>.json`
names the exact source SHA and tree it ran on.

Phases:

1. A pinned disposable PostgreSQL 16.10 is started with the shared provisioner.
2. The upgrade baseline is the previous three migrations. The sentinel is
   written as the migration role, then all migrations are applied, then the
   sentinel is collected into custody **as the runtime role**. This proves the
   repair.
3. Re-applying the migrations is a no-op.
4. The runtime role cannot read `_prisma_migrations`.
5. Prisma reports no schema drift.
6. All integration specs run as `cw_billing_app` with two replicas on separate
   pools.

Dependencies:

| Dependency | How it was provided |
| ---------- | ------------------- |
| PostgreSQL | REAL |
| Identity | Local HTTP stub |
| Pricing `getQuote` and `validateQuote` | Local HTTP stubs of the published shapes |
| Workload credentials | Local test values |
| RabbitMQ | NOT USED (outbox rows are asserted; the relay is not started) |

Recorded run: `docs/production/B/evidence/billing-postgres-937f637fba4a.json`.
It ran on source `937f637fba4a11fbacf729cfbafdc169d654b94d` (tree
`5bfe43ab192b258f2ab961dd9c37f5628ac8837a`), clean, `accepted: true`:
67 tests, 67 passed, 0 skipped. The previous history was the three earlier
migrations; the added one is `20261011100000_p06b4_booking_obligations`.
The commit that adds this document and the evidence file changes only
`docs/`, so the evidence covers the exact service source of the PR head.

Failed runs before acceptance, reported rather than hidden:

1. On `5a22f62`: the upgrade phase failed with
   `permission denied for function billing_assert_obligation_ledger`.
   `billing_check_journal_effects` also calls the helpers. It was added to
   the repair in `e7b1c60`.
2. On `e7b1c60`: all 16 booking-saga integration tests passed. One existing custody test
   failed (`lifecycle ... reconciled`) because the outbox order was ambiguous
   on equal `created_at` under `FixedClock`. Fixed in `937f637`: events are
   now ordered by aggregate version on ties (the same change as open P04-B1).
3. On `937f637`: the first run failed one existing test,
   `create race: the same key on two replicas yields one obligation and one
   outcome`. It took 10.08 s while three other lanes were building on the
   same machine. That test uses 1 s upstream-stub timeouts. The immediate
   re-run on the same source passed 67/67; that run is the recorded one.
   This is a load-sensitive timing in an existing test, not a fixed defect.
   It is noted for the reviewer.

## Results

| Family | Result |
| ------ | ------ |
| Billing typecheck / build | PASSED (`tsc --noEmit`, `tsc -p tsconfig.build.json`) |
| Billing unit + adapter specs (`test/*.spec.ts`) | PASSED 51/51 (11 of them are new booking-saga specs) |
| Real PostgreSQL acceptance (all billing integration specs) | PASSED 67/67 on `937f637` (one earlier run on the same source failed under load; see above) |
| ESLint / Prettier (billing, script) | PASSED |
| `check-migrations` (incl. `--base-ref origin/main`), boundaries, layers, service shells | PASSED |
| `check-design-reference` | PASSED (no UI change) |
| Real RabbitMQ relay | BLOCKED (see B4-04) |
| Real Booking → Billing journey | BLOCKED (see B4-01) |

## Rollback / compensation

- **Before any booking link exists:** revert the code, then drop the table,
  its triggers and its two guard functions. Keep `SECURITY DEFINER`, because
  removing it re-breaks runtime writes.
- **After links exist:** the link is a financial fact. Rollback needs a
  reviewed data plan; never drop it silently.
- **Saga compensation is the void route itself.** It is idempotent per key.
  It never reverses money, because a void requires that no payment was
  reported.

## Expected rebase interaction with PR #125 (P04-B1)

#125 also edits these files:

- `billing.ports.ts` (UoW and repository members);
- `prisma-billing.repository.ts`;
- `schema.prisma` (relation lines);
- `app.module.ts`;
- the acceptance script (`previousMigrations`, sentinel role).

Every hunk here is additive and small. The rebase that lands second must:

- keep both sets of members;
- order migrations by timestamp (`20261010100000` before `20261011100000`);
- set the billing `previousMigrations` to the pre-change count of the merged
  history.

The `SECURITY DEFINER` statements are idempotent across both migrations.

## Blockers (exact, none generic)

| ID | Blocker | Owner |
| -- | ------- | ----- |
| B4-01 | Booking's `BillingObligationsAdapter` calls unpublished paths: `POST /internal/v1/billing/obligations` with a saga body and `POST /obligations/void-for-booking`. It must move to the published `/booking-obligations` routes and `{ expectedRevision }` void body. It reads `quoteId`, `obligationId` and `amount` from `ObligationV1`, which this route returns. | Lane C (Booking) |
| B4-02 | CR-B-09: add the quote revision to `CreateBookingObligationRequestV1` (Booking already holds it). Until then Billing validates at revision 1 and, on `REVISION_MISMATCH`, makes exactly one more safe call at the revision Pricing names. | Lane E |
| B4-03 | Pricing must serve the published `validateQuote` on service scope `pricing.quote.validate` and register Billing's workload client (P06-B2). Until both exist, a booking-saga create is 503, never a guessed amount. | Lane B (P06-B2) + deployment config |
| B4-04 | The Billing outbox relay needs `@carwash/platform-messaging` as a Billing dependency (a lockfile change). The outbox rows are written and asserted; nothing is published to RabbitMQ yet. | Lane E |
| B4-05 | Deployment secrets must be provisioned: `BILLING_SERVICE_CLIENTS` (Booking's digest) and `BILLING_PRICING_SERVICE_TOKEN_FILE`. They are not in the repository. | Platform / E |
