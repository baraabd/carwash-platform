# P06-B1 — Catalog serves the published catalog.v1 contract

Status: **implemented and locally verified; review required; parent P06-B
INTEGRATION_PENDING**. Readiness remains 503. Not production-ready, not
deployed, not integrated with a real Identity, Gateway or broker.

## Provenance

| Item | Value |
| ---- | ----- |
| Base (refreshed `origin/main`, 2026-10-11) | `66aa7528500a06f65a4b73305506feee7c3fc3b3`, tree `3a2203e360a534dc3f98529717a7625257aaccd0` |
| Audited start in the task | `f875d31` — an ancestor of the base, no longer current |
| Branch | `prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b1-catalog-v1` |
| Head / tree | recorded in the PR description and in `evidence/catalog-postgres-*.json` (`sourceSHA`, `sourceTree`) |
| Migration added | `20261011090000_p06b1_catalog_v1_definitions` (append-only, expand) |
| Contract served | `catalog.v1` (`@carwash/contracts` `CATALOG_V1`) |
| Event emitted | `catalog.definitions-published.v1` (envelope v2, `@carwash/event-contracts` business-v1) |

## Why

`catalog.v1` was published by Lane E (P01-E1), but Catalog still served the
pre-contract P01-B1 model (categories/packages/add-ons, slug ids, scheduled
effective dates) on conflicting paths (`GET /definitions/:revision`,
`POST /definitions`, `GET /revisions`). No consumer could use Catalog through the
contract, and Pricing could not resolve definition ids. This child closes that
provider gap. It is the first item of the P06-B commerce crosswalk.

## What changed

| Layer | Files | Notes |
| ----- | ----- | ----- |
| domain | `domain/catalog-v1.ts` | Pure publication plan: complete snapshots, identity stability, final retirement, per-definition content revision, NO_CHANGES |
| application | `catalog.service.ts`, `catalog-v1-wire.ts`, `catalog-errors.ts`, `events.ts` | Use cases, local restatement of the published request parser, error vocabulary, self-validated outbox event |
| ports | `ports/catalog.ports.ts` | Repository/UoW incl. outbox, Clock, Ids, Hasher, AccessAuthority |
| infrastructure | `persistence/prisma-catalog.repository.ts` | One transaction: lock, receipt, publication, identity, snapshot rows, audit, outbox |
| transport | `catalog.controller.ts`, `error-envelope.ts`, `install.ts` | Three contract routes, shared error envelope, request/correlation ids, 512 KB body limit |

Removed: `domain/catalog-definitions.ts`, `domain/catalog-revision.ts` and the
pre-contract HTTP routes (no consumer existed; Gateway pointed at an undefined
path). Kept: `domain/quote.ts` (unconnected; removal needs E-owned inventory
edits, CR-B-P06-05) and the P01-B1 tables (frozen; a destructive drop needs its
own reviewed data plan).

## Domain rules

- A catalog revision is a **complete snapshot** (≤ 200 definitions incl.
  retired). Omitting a known definition is `DEFINITION_MISSING`; retirement is
  explicit `status: RETIRED`.
- `definitionId` keeps `kind` and `code` forever (`DEFINITION_IDENTITY_CHANGED`);
  a code is never reused by another id, even after retirement.
- Retirement is final (`DEFINITION_RETIRED`); a new definition cannot start
  retired. Re-offering a service means a new `definitionId`.
- Each definition's `revision` is 1 when created and +1 only when content
  changes. Vehicle types are canonicalised (`sedan, suv, large, pickup` order),
  so order is never a change. Publishing nothing new is `NO_CHANGES`.
- Publications are effective immediately (`publishedAt`); the contract has no
  scheduled effectivity.

## HTTP behaviour

| Route | Access | Success | Errors (published envelope) |
| ----- | ------ | ------- | --------------------------- |
| `GET /definitions` | public | 200 `CatalogV1` (complete snapshot) | 404 before the first publication |
| `GET /definitions/:definitionId` | public | 200 `DefinitionV1` (retired included) | 404 unknown/invalid id |
| `POST /publications` | `catalog.publish`, `Idempotency-Key` | 201 `CatalogV1` | 401, 403, 428 key required, 400 bad key/JSON, 422 `VALIDATION_FAILED` (issues), 412 `REVISION_CONFLICT`, 422 `BUSINESS_RULE_VIOLATION` (reason `DEFINITION_RETIRED`/`DUPLICATE_CODE` or issue code), 409 `IDEMPOTENCY_CONFLICT`, 503 `DEPENDENCY_UNAVAILABLE` |

- Idempotency: receipt per (actor, operation, key) with a fingerprint over
  `{contract, operation, actor, body}`; replay returns the recorded outcome,
  including recorded rejections, with `idempotency-replayed: true`.
- Concurrency: a singleton row lock serialises publishers; the expected revision
  check and the unique/FK/trigger constraints are the backstop.
- Reads are public by contract (no Identity call). Publishing asks Identity for
  a current decision on every request; failure is 503, never a grant.
- Logs carry status, code, replay flag and ids only; no definition text, token
  or body.

## Persistence (PostgreSQL)

`catalog_v1_publication` (linear chain, reason code, snapshot fingerprint),
`catalog_v1_definition_identity` (insert-only; unique code; binding key),
`catalog_v1_definition` (snapshot rows; composite FK to the identity binding so
kind/code drift is impossible; vehicle-type subset CHECK). Triggers: no
UPDATE/DELETE on any of them; rows only in the publication's own transaction;
continuity against the previous snapshot (final retirement, revision step 0/1,
new = revision 1 and PUBLISHED); DEFERRED constraint trigger at COMMIT rejects an
empty or incomplete snapshot. `catalog_audit_event` gains nullable `reason_code`
and the two new actions (old actions remain valid).

Rollback: the release is expand-only. Rolling the code back to P01-B1 leaves the
new tables unused; the old tables are untouched. Rolling forward again needs no
data repair. A future contract migration may drop the legacy tables after a
reviewed data plan.

## Evidence

| Family | Command | Result | Dependencies |
| ------ | ------- | ------ | ------------ |
| Domain + wire unit | `node --test services/catalog/dist-tests/test/catalog.domain.spec.js` | PASSED | none |
| HTTP auth/idempotency/race/outbox | `node --test services/catalog/dist-tests/test/catalog.http.spec.js` | PASSED | in-memory repository double, local Identity HTTP stub |
| Nest runtime/health | `node --test services/catalog/dist-tests/test/catalog.nest.spec.js` | PASSED | none |
| Provider contract (published parsers) | `node --test tests/production/B/catalog-v1-provider.test.mjs` | PASSED (4/4) | published `@carwash/contracts` dist; in-memory repository |
| Real PostgreSQL | `node scripts/production/B/postgres-acceptance.mjs --service catalog --record` | see `evidence/catalog-postgres-*.json` | REAL disposable PostgreSQL 16.10; Identity LOCAL HTTP STUB; broker NOT USED |
| Typecheck / lint / format | `pnpm --filter @carwash/catalog typecheck`, `eslint`, `prettier --check` | PASSED | — |
| Migration / boundary / layer guards | `check-migrations`, `check-boundaries`, `check-layers` | PASSED | — |
| Design lock | `node scripts/check-design-reference.mjs` | PASSED (no UI touched) | — |
| E source inventory | `node --test tests/parallel/E/status.test.mjs` | FAILED by design until CR-B-P06-05 registers the three new models | — |
| RabbitMQ relay | — | BLOCKED (CR-B-P06-04: topology/relay are E-owned); rows are written and parsed, not published | — |

The PostgreSQL suite proves: exact round-trip across two replicas (separate
pools); audit and outbox rows in the same transaction with a valid envelope;
six concurrent publishers on two replicas → one 201 and five 412; one key raced
on two replicas → one commit, identical replay; final retirement and code
binding through the API; immutability for the runtime role; and database-level
rejection of empty/incomplete snapshots, revived retirement, revision gaps, kind
drift and code reuse written directly in SQL. The upgrade phase writes a P01-B1
legacy revision under the previous schema and proves it survives and stays
immutable.

## Remaining blockers (exact)

- CR-B-P06-01 (E): allow `expectedCatalogRevision: 0` in the published parser.
- CR-B-P06-02 (E): Gateway `customer.catalog` upstream → `/definitions`.
- CR-B-P06-03 (E): `@carwash/contracts` dependency for Catalog.
- CR-B-P06-04 (E): `washgo.catalog.events` topology and relay deployment.
- CR-B-P06-05 (E): register persistence models; remove `quote.ts` references.
- CR-B-P06-06 (owner/E): real `catalog.publish` holders per environment.
- Readiness promotion (E) after real Identity-to-Catalog acceptance.

## Next consumers

Pricing (P06-B2: price books keyed by catalog.v1 `definitionId`, quote
selections validated against the published snapshot), Gateway public catalog
route, admin catalog editor (Lane D; no approved admin design exists yet).
