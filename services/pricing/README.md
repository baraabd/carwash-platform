# pricing-service

**Status: serves the published `pricing.v1` contract (P06-B2). Readiness stays
HTTP 503 (`BUSINESS_READY = false`). All money commands fail closed until the
owner's currency policy (B-03) and quote TTL (B-05) are configured; price book
publication also fails closed until the Catalog owner origin is configured.**

Pricing owns price books, exact unit prices and immutable, expiring
server-issued quotes (`architecture/service-catalog.json`). Database `cw_pricing`,
schema `app`; runtime role `cw_pricing_app` (DML only), migration role
`cw_pricing_migrate`. Runtime startup never performs migrations.

## Model

- **Money**: integer minor units (`bigint` / PostgreSQL `BIGINT`); on the wire
  `{currency, amountMinor, scale}` from the closed pricing.v1 currency list. The
  configured policy must match that list exactly; nothing is rescaled.
- **Price book**: one immutable, complete set of unit prices per (definition,
  vehicle type), or per definition for every eligible type (`vehicleType: null`).
  Every PUBLISHED catalog definition must be priced for every vehicle type it
  supports; unknown, retired or ineligible entries are refused. Revisions form a
  linear chain; the newest committed revision is in force.
- **Catalog view**: read from the Catalog OWNER's published catalog.v1
  `GET /definitions` at publication and stored with the book, so quoting never
  calls Catalog synchronously.
- **Quote**: computed from IDs and quantities only, for the caller itself.
  Exactly one PACKAGE (quantity 1) plus EXTRA lines; `amount = unitPrice x
quantity`, total = sum of lines (enforced again at COMMIT). Expiry = TTL;
  status is evaluated at server time. A newer price book never changes an issued
  quote. No DISCOUNT/FEE/TAX/VEHICLE_SURCHARGE lines (B-04/B-10 open).

## HTTP (`/internal/v1/pricing`, published `pricing.v1`)

| Method | Path                         | Authority                                               |
| ------ | ---------------------------- | ------------------------------------------------------- |
| POST   | `/quotes`                    | principal with `bookings.create:self`, `Idempotency-Key` |
| GET    | `/quotes/:quoteId`           | the quote's beneficiary only (others get 404)           |
| POST   | `/quotes/:quoteId/validate`  | service scope `pricing.quote.validate` (safe, audited)  |
| POST   | `/price-books`               | `pricing.prices.publish`, `Idempotency-Key`             |

Errors use the shared contract envelope (`code`, `reason`, `issues`, ids,
`retryable`).

Configuration: `DATABASE_URL` (required); `IDENTITY_SESSION_ORIGIN`,
`IDENTITY_SESSION_TIMEOUT_MS`; `CATALOG_ORIGIN`, `CATALOG_TIMEOUT_MS`;
`PRICING_SERVICE_CLIENTS` (digests only); `PRICING_CURRENCY_POLICY` (JSON
`{revision,currency,minorUnitExponent,maxAmountMinor}`) and
`PRICING_QUOTE_TTL_SECONDS` (60–86400). Unset ⇒ fail closed; invalid ⇒ startup
error.

## Commands (repository root)

- `pnpm --filter @carwash/pricing generate | build | typecheck | test:runtime`
- `node scripts/production/B/postgres-acceptance.mjs --service pricing` — real
  disposable PostgreSQL: provisioning, upgrade migration, drift check and the
  integration specs as the runtime role.
- `node --test tests/production/B/pricing-v1-conformance.test.mjs` — published
  contract parsers against real Pricing responses.
- `docker build -f services/pricing/Dockerfile -t washgo/pricing:dev .`

Design and evidence: `docs/production/B/P06-B2-PRICING-V1.md` (supersedes the
API part of `P01-B2-PRICING.md`).
