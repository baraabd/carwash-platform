# pricing-service

**Status: owner domain, persistence and HTTP API implemented (P01-B2). Readiness
stays HTTP 503 (`BUSINESS_READY = false`). Price publication is fail-closed until
Lane E publishes the Catalog read contract; all money commands are fail-closed
until the owner's currency policy (B-03) and quote TTL (B-05) are configured.**

Pricing owns price versions, exact rates and immutable, expiring server-issued
quotes (`architecture/service-catalog.json`). Database `cw_pricing`, schema `app`;
runtime role `cw_pricing_app` (DML only), migration role `cw_pricing_migrate`.
Runtime startup never performs migrations.

## Model

- **Money**: non-negative integer minor units (`bigint` / PostgreSQL `BIGINT`),
  canonical decimal strings on the wire, explicit currency, exponent and maximum
  from an accepted policy revision. No floating point and no default currency.
- **Price version**: immutable rates for ONE catalog revision — `PACKAGE`,
  `VEHICLE` surcharge (own line, as in the approved bill) and `ADDON` for optional
  add-ons. Every package and category and every chargeable add-on must be priced;
  included add-ons cannot be. Versions form a linear chain with strictly increasing
  `effectiveFrom`; a version never starts before its catalog revision.
- **Catalog view**: Pricing stores its own immutable copy of the catalog view it
  validated rates against, so quoting never calls Catalog synchronously.
- **Quote**: computed from IDs only (`catalogRevision`, `categoryId`, `packageId`,
  `addonIds`); client totals/prices are rejected. Immutable lines, subtotal, total,
  duration, issue/expiry times and an input fingerprint. Expiry = TTL, capped at
  the next scheduled price version. Status (`USABLE`/`EXPIRED`) is evaluated at
  server time. No discount/fee/tax lines in v1 (B-04/B-10 open), so total = subtotal.

## HTTP (`/internal/v1/pricing`, proposed v1 — not yet an E-published contract)

| Method | Path                   | Authority                                         |
| ------ | ---------------------- | ------------------------------------------------- |
| GET    | `/prices`              | any verified Identity session                     |
| GET    | `/price-versions`      | `pricing.publish` (requested from E)              |
| POST   | `/prices`              | `pricing.publish` + `Idempotency-Key`             |
| POST   | `/quotes`              | `bookings.create:self` + `Idempotency-Key`        |
| GET    | `/quotes/:id`          | owner only (others get 404)                       |
| POST   | `/quotes/:id/validate` | owner only; read-only usability + selection check |

Configuration: `DATABASE_URL` (required); `IDENTITY_SESSION_ORIGIN`,
`IDENTITY_SESSION_TIMEOUT_MS`; `PRICING_CURRENCY_POLICY` (JSON
`{revision,currency,minorUnitExponent,maxAmountMinor}`) and
`PRICING_QUOTE_TTL_SECONDS` (60–86400). Unset ⇒ fail closed with 503; invalid ⇒
startup error.

## Commands (repository root)

- `pnpm --filter @carwash/pricing generate | build | typecheck | test:runtime`
- `node scripts/production/B/postgres-acceptance.mjs --service pricing` — real
  disposable PostgreSQL: provisioning, upgrade migration, drift check and the
  integration specs as the runtime role.
- `docker build -f services/pricing/Dockerfile -t washgo/pricing:dev .`

Design and evidence: `docs/production/B/P01-B2-PRICING.md`.
