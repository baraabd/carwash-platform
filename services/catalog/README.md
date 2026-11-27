# catalog-service

**Status: serves the published `catalog.v1` contract (P06-B1). Readiness stays
HTTP 503 (`BUSINESS_READY = false`) until Lane E promotes it, grants
`catalog.publish` to real staff and registers the persistence models.**

Catalog owns wash definitions: packages and extras with their duration and
eligible vehicle types. It **never owns money**: prices and quotes belong to
Pricing (`architecture/service-catalog.json`). The legacy `src/domain/quote.ts`
helper is unconnected, is not exported by the domain index and must not be used
for pricing; its removal needs the E-owned inventories updated first
(CR-B-P06-05).

Database: `cw_catalog`, schema `app`. Runtime role `cw_catalog_app` (DML only),
migration role `cw_catalog_migrate`. No other service may read or write these
tables.

## Model

- A catalog revision is a **complete, immutable snapshot**. Every definition
  ever published stays in every later snapshot; retirement is explicit
  (`status: RETIRED`) and final.
- A `definitionId` keeps its kind and code forever; a code is never reused.
- Each definition has its own content `revision` (+1 only when it changes).
- PostgreSQL enforces immutability, the linear chain, identity binding,
  final retirement and (at COMMIT) snapshot completeness for every role.
- Publishing requires `expectedCatalogRevision` and an `Idempotency-Key`; the
  receipt, snapshot, audit row and `catalog.definitions-published.v1` outbox
  row commit together.
- The P01-B1 pre-contract tables are frozen legacy storage (no runtime reader
  or writer).

## HTTP (`/internal/v1/catalog`, catalog.v1)

| Method | Path                         | Authority                                    |
| ------ | ---------------------------- | -------------------------------------------- |
| GET    | `/current`                   | public; explicit `UNPUBLISHED` or `PUBLISHED` owner state |
| GET    | `/definitions`               | public                                       |
| GET    | `/definitions/:definitionId` | public                                       |
| POST   | `/publications`              | `catalog.publish` + `Idempotency-Key` header |

Publishing is authorised by a **current** Identity decision
(`GET /internal/v1/identity/session`, `IDENTITY_SESSION_ORIGIN`). Missing or
unreachable Identity fails closed with 503; nothing is cached. Errors use the
published API error envelope.

The current-state read returns `{state, catalog, expectedCatalogRevision, asOf}`.
Before the first publication, `catalog` is `null` and the comparison revision is
`0`. It does not create a fake published snapshot: `/definitions` continues to
return 404, and the published `CatalogV1` parser still requires revision 1 or later.
Both the canonical request parser and owner accept `expectedCatalogRevision: 0`
for that initial command. A concurrent winner changes the head, so another
publisher with the same initial precondition receives a recorded 412 conflict.
Repository failure remains an error and never becomes an unpublished state.

S05 bootstrap acceptance adds real HTTP/provider tests for this read, first
publication and concurrent preconditions, and extends the real PostgreSQL suite
to consume the explicit current state across two independent replicas. The local
HTTP tests use the declared in-memory persistence double; PostgreSQL acceptance
must run through the existing disposable-database runner.

Configuration: `DATABASE_URL` (required), `IDENTITY_SESSION_ORIGIN` (https or
loopback http; unset ⇒ every publish is 503), `IDENTITY_SESSION_TIMEOUT_MS`
(100–10000, default 2000).

## Commands (repository root)

- `pnpm --filter @carwash/catalog generate | build | typecheck | build:tests`
- `node --test services/catalog/dist-tests/test/*.spec.js` — domain, HTTP
  (in-memory repository test double) and Nest runtime specs.
- `node --test tests/production/B/catalog-v1-provider.test.mjs` — published
  catalog.v1 parsers against the real HTTP adapter (needs `pnpm build:packages`).
- `node scripts/production/B/postgres-acceptance.mjs --service catalog` — real
  disposable PostgreSQL: provisioning, upgrade migration with legacy sentinel,
  drift check and the integration specs as the runtime role.

Design and evidence: `docs/production/B/P06-B1-CATALOG-V1.md`.
