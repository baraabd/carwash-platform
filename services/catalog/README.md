# catalog-service

**Status: owner domain, persistence and HTTP API implemented (P01-B1). Readiness
stays HTTP 503 (`BUSINESS_READY = false`) until Lane E publishes the catalog
contract, the `catalog.publish` grant and readiness promotion.**

Catalog owns wash definitions: vehicle categories (with extra duration),
packages, add-ons, durations and explicit compatibility (allowed categories,
included and optional add-ons). It **never owns money**: prices and quotes belong
to Pricing (`architecture/service-catalog.json`). The legacy
`src/domain/quote.ts` helper is unconnected, is not exported by the domain index
and must not be used for pricing.

Database: `cw_catalog`, schema `app`. Runtime role `cw_catalog_app` (DML only),
migration role `cw_catalog_migrate`. No other service may read or write these
tables.

## Model

- Definitions are published as **immutable revisions** that form one linear
  chain (`previous_revision = revision - 1`). Effective dates strictly increase,
  so revision N is in force on `[effectiveFrom(N), effectiveFrom(N+1))`.
- Retiring a definition = publishing a new revision without it. Published rows
  are never updated or deleted; PostgreSQL triggers enforce this for every role.
- Publishing requires `expectedRevision` (optimistic concurrency) and an
  `Idempotency-Key`; the receipt, revision and audit row commit together.

## HTTP (`/internal/v1/catalog`, proposed v1 — not yet an E-published contract)

| Method | Path                         | Authority                                    |
| ------ | ---------------------------- | -------------------------------------------- |
| GET    | `/definitions`               | any verified Identity session                |
| GET    | `/definitions/:revision`     | any verified Identity session                |
| GET    | `/revisions`                 | `catalog.publish` (requested from E)         |
| POST   | `/definitions`               | `catalog.publish` + `Idempotency-Key` header |

Every request is authorised by a **current** Identity decision
(`GET /internal/v1/identity/session`, `IDENTITY_SESSION_ORIGIN`). Missing or
unreachable Identity fails closed with 503; nothing is cached.

Configuration: `DATABASE_URL` (required), `IDENTITY_SESSION_ORIGIN` (https or
loopback http; unset ⇒ all protected requests 503), `IDENTITY_SESSION_TIMEOUT_MS`
(100–10000, default 2000).

## Commands (repository root)

- `pnpm --filter @carwash/catalog generate | build | typecheck | build:tests`
- `node --test services/catalog/dist-tests/test/*.spec.js` — domain, HTTP (in-memory
  repository test double) and Nest runtime specs.
- `node scripts/production/B/postgres-acceptance.mjs --service catalog` — real
  disposable PostgreSQL: provisioning, upgrade migration, drift check and the
  integration specs as the runtime role.

Design and evidence: `docs/production/B/P01-B1-CATALOG.md`.
