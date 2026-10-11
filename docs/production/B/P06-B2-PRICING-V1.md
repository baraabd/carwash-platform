# P06-B2 — Pricing serves the published `pricing.v1`

Parent: P06-B (Close commerce/finance functional matrix and admin finance
contracts). Parent status: **INTEGRATION_PENDING**. This child is not
production-ready, not deployed and not integrated with a real Identity or Catalog.

| Item | Value |
| ---- | ----- |
| Base (main, refreshed 2026-10-11) | `3e1ab23bff450235858ea13e049f8fb373df393f` |
| Tested source head | `3491e667400b12daf0e28955296867b23cb3bd4f` (tree `d0a913e353d172711bc19b49ede84016054f0edc`) |
| Branch | `prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b2-pricing-v1` |
| Contract | `pricing.v1` (published by E in `@carwash/contracts`), `catalog.v1` consumed, shared `ApiErrorEnvelope` |
| Migration | `20261011100000_p06b2_pricing_v1_price_books_quotes` (append-only, expand) |
| Closes | B-P02-03 (Pricing served a pre-contract quote shape) |

The audited start `f875d31` was no longer current; work started on `66aa752` and
was rebased onto `3e1ab23` (P04-B/C/D merges) before the final evidence run.

## What changed

- **Routes** (`/internal/v1/pricing`), exactly the contract route table:
  `POST /quotes` (principal with `bookings.create:self`, `Idempotency-Key`; the
  beneficiary must be the caller — kind and subject), `GET /quotes/:quoteId`
  (beneficiary only; foreign and missing are both 404), `POST
  /quotes/:quoteId/validate` (service scope `pricing.quote.validate` through the
  P04-E3 `x-service-client`/`x-service-token` primitive; safe; every decision
  audited with caller and declared purpose) and `POST /price-books`
  (`pricing.prices.publish`, `Idempotency-Key`, revision compare-and-set).
- **Pre-contract API removed.** `/prices`, `/price-versions` and the slug-based
  quote had no consumer (Booking and Billing already parse `pricing.v1`), and
  price publication there was permanently 503 (pending Catalog reader). The
  P01-B2 tables stay (expand only); a contract-phase drop needs a reviewed data
  plan.
- **Money**: domain `bigint` minor units; wire `{currency, amountMinor, scale}`
  from the closed contract list. A configured policy whose currency/exponent the
  contract cannot carry fails closed (`DEPENDENCY_UNAVAILABLE / POLICY_UNAVAILABLE`).
- **Price book**: complete coverage of every PUBLISHED catalog definition for every
  eligible vehicle type (specific entry, or `vehicleType: null` for all); unknown,
  retired and ineligible entries are refused with field issues (`VALIDATION_FAILED`).
  The catalog view comes from the Catalog owner's `catalog.v1 GET /definitions`
  through a bounded adapter (timeout, no redirect, 1 MiB cap, closed-shape parse,
  never a guessed catalog → `UPSTREAM_UNAVAILABLE`), and is stored with the book.
- **Quote**: one PACKAGE (quantity 1) + EXTRA lines, `amount = unitPrice × quantity`,
  total = Σ lines; expiry = TTL from the injected clock; a newer book never changes
  an issued quote. `REVOKED` is never produced (no revoke command in `pricing.v1`;
  B-05 open). No DISCOUNT/FEE/TAX/VEHICLE_SURCHARGE lines (B-04/B-10 open); the
  database refuses them.
- **Errors**: route errors use `ApiErrorEnvelope` (code, owner reason, issues, ids,
  retryable). Pre-routing body-parser refusals still use the service-kit envelope
  installed by `bootstrapService` (request CR-B-P06-PRC-05); no parser text leaks.
- **Database invariants** (runtime role cannot bypass): immutable books, entries,
  quotes, lines, receipts and audit; entries/lines only in their parent's
  transaction; COMMIT-time checks (book has entries; quote has exactly one PACKAGE,
  lines sum to total, matches its book's currency/scale/catalog/policy); contract
  currency/scale CHECK; line amount CHECK.
- **Defect found and fixed by the real PG run**: the linear-chain CHECK evaluated to
  NULL (and passed) for `revision > 1` with a NULL predecessor. Fixed for
  `price_book`, and the identical hole in P01-B2 `price_version_linear_chain` is
  tightened in the same migration (all existing rows already satisfy it).

## Evidence (exact source `3491e66`)

| Family | Command | Result |
| ------ | ------- | ------ |
| Domain/unit incl. model-based (500 generated books/selections) | `node --test services/pricing/dist-tests/test/*.spec.js` | **PASSED** 31/31 (10 domain, 12 HTTP, 9 Nest/health) |
| HTTP auth/object access, idempotency, races (in-memory persistence double) | same | **PASSED** |
| Real PostgreSQL: provisioning, upgrade from 3 previous migrations with legacy sentinel, migration-history restriction, schema-mirror drift, 9 integration specs as runtime role incl. two-replica races | `node scripts/production/B/postgres-acceptance.mjs --service pricing --record` | **PASSED** — `evidence/pricing-postgres-3491e667400b.json` |
| Provider conformance vs published parsers (`parseQuoteV1`, `parseQuoteValidationV1`, `parsePublishPriceBookRequestV1`, `parseCatalogV1`, `parseApiErrorEnvelope`, route table, vocabularies) | `node --test tests/production/B/pricing-v1-conformance.test.mjs` | **PASSED** 4/4 |
| Typecheck/build | `pnpm --filter @carwash/pricing build:tests` | **PASSED** |
| Migration guards (append-only vs `origin/main`) | `node scripts/check-migrations.mjs --base-ref origin/main` | **PASSED** |
| Layers / boundaries | `check-layers.mjs`, `check-boundaries.mjs` | **PASSED** |
| Design lock | `node scripts/check-design-reference.mjs` | **PASSED** (no UI change) |
| Prettier / ESLint on changed paths | `prettier --check`, `eslint` | **PASSED** |
| Source inventory (`tests/parallel/E/status.test.mjs`) | — | **FAILED by design**: new persistence models need E registration (CR-B-P06-PRC-06) |
| RabbitMQ / events | — | **BLOCKED**: no pricing event registered (CR-B-P06-PRC-07) |
| Real Identity / real Catalog / Gateway journey / Playwright | — | **BLOCKED / NOT APPLICABLE**: stubs only; Catalog on main does not yet serve `catalog.v1` (sibling P06-B1); no UI change |

An earlier run on the pre-rebase head found the chain defect (NOT ACCEPTED); its
record was discarded because that commit no longer exists on the branch.

Real vs stubbed: PostgreSQL 16.10 is real (disposable). Identity and Catalog are
local HTTP stubs of their published contracts; the service caller is a test
credential. Nothing here is production, deployment or integrated-journey evidence.

## Security and privacy

Deny by default: quotes only for the caller, reads only by the beneficiary,
validation only for scoped workload clients, publication only with the contract
permission (today no real session holds it — CR-B-P06-PRC-01). Audit stores actor,
action, object reference, purpose and outcome only (no amounts, beneficiary or
credential). No user credential is forwarded to Catalog.

## Rollback / compensation

Pricing has no distributed write here. Rollback = redeploy the previous image; the
new tables stay (expand only) and the old code never reads them. Old-code writes
to the legacy tables still satisfy the tightened chain CHECK. Consumers (Booking,
Billing) already expect `pricing.v1`, so rolling back re-opens B-P02-03.

## Remaining blockers

| ID | Blocker | Owner |
| -- | ------- | ----- |
| CR-B-P06-PRC-01 | Publish permission name: contract `pricing.prices.publish` vs Identity `pricing.publish` | E |
| CR-B-P06-PRC-02 | Document `expectedPriceBookRevision` = revision being created | E |
| CR-B-P06-PRC-03 | Staff read route for the book in force (admin finance console) | E, then B |
| CR-B-P06-PRC-04 | Booking workload credential for `validateQuote` | E (deployment) |
| CR-B-P06-PRC-05 | Contract envelope for pre-routing refusals in service-kit | E |
| CR-B-P06-PRC-06 | `implementation-status.json` persistence models (blocks CI `static`) | E |
| CR-B-P06-PRC-07 | `pricing.price-published.v1` registration before any outbox write | E |
| B-03/B-04/B-05/B-10 | Currency policy, real rates/fees/tax, TTL/revocation, promotions | Owner (external) |
| — | Catalog serving `catalog.v1` for real Pricing→Catalog acceptance | B (P06-B1) |

Next consumers: Billing's `PricingQuoteReader` (B-P02-03 closed on the provider
side), Booking's quote reader/validator, Gateway aliases, admin finance console.
