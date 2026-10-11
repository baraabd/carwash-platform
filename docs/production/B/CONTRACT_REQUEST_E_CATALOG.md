# Contract request to Lane E — Catalog v1 (from P01-B1)

Status: **SUBMITTED, not accepted**. Lane B does not edit `packages/contracts`,
`packages/event-contracts`, Gateway routes, Identity permissions, root
dependencies, lockfiles, CI or the readiness guard. Each item below is an exact
request; Lane B consumes only E's merged, versioned result.

Provider implementation: `services/catalog` at the PR head of
`prod/p01-b-implement-catalog-and-pricing-production-providers-b1-catalog`.

## CR-B1-1 HTTP contract `catalog.v1` in `@carwash/contracts`

Register `{ id: 'catalog.v1', domain: 'catalog', version: 1, prefix: '/internal/v1/catalog' }`
and publish these wire types (they match the implemented provider exactly):

```ts
interface CatalogVehicleCategoryV1 { id: string; labelAr: string; labelEn: string | null; extraDurationMinutes: number; sortOrder: number }
interface CatalogAddonV1 { id: string; labelAr: string; labelEn: string | null; durationMinutes: number; sortOrder: number; allowedCategoryIds: string[] }
interface CatalogPackageV1 { id: string; labelAr: string; labelEn: string | null; descriptionAr: string | null; durationMinutes: number; sortOrder: number;
  featuresAr: string[]; allowedCategoryIds: string[]; includedAddonIds: string[]; optionalAddonIds: string[] }
interface CatalogDefinitionsV1 { categories: CatalogVehicleCategoryV1[]; packages: CatalogPackageV1[]; addons: CatalogAddonV1[] }
interface CatalogRevisionViewV1 { revision: number; effectiveFrom: string; effectiveUntil: string | null; publishedAt: string;
  definitionsFingerprint: string; definitions: CatalogDefinitionsV1 }
interface CatalogPublishCommandV1 { expectedRevision: number; effectiveFrom: string | null; definitions: CatalogDefinitionsV1 }
```

Routes: `GET /definitions`, `GET /definitions/:revision` (`[1-9][0-9]{0,9}`),
`GET /revisions`, `POST /definitions` (Idempotency-Key required). Error reason
codes: `REQUEST_INVALID`, `IDEMPOTENCY_KEY_INVALID`, `AUTH_REQUIRED`,
`AUTH_FORBIDDEN`, `AUTH_UNAVAILABLE`, `NOT_FOUND`, `CATALOG_NOT_PUBLISHED`,
`IDEMPOTENCY_CONFLICT`, `REVISION_CONFLICT`, `DEFINITIONS_INVALID`,
`EFFECTIVE_FROM_IN_PAST`, `EFFECTIVE_FROM_NOT_AFTER_PREVIOUS`, `EFFECTIVE_FROM_TOO_FAR`.

Consumers: Pricing (exact revision read at price publication), Booking (selection
validation against the pinned revision), customer/admin web via Gateway.

## CR-B1-2 Identity permission `catalog.publish`

Add `catalog.publish` to `IDENTITY_PERMISSIONS` and grant it to an E/owner-approved
role (proposal: `operations` and `super-admin`; not `customer`/`technician`).
Until then publishing is denied for every caller (fail-closed).

## CR-B1-3 Gateway routes

- Replace the existing `customer.catalog` upstream `/internal/v1/catalog/packages`
  (never implemented) with `/internal/v1/catalog/definitions`, read-only.
- Admin aliases for `GET /revisions` and `POST /definitions` with
  `permission: 'catalog.publish'` and `idempotency: 'required'`.
- Decide the guest/public read mode (B-15). Catalog currently requires a session.

## CR-B1-4 Service-to-service read identity

Pricing must read `GET /definitions/:revision` as a **service**, not by replaying
an end-user token. Request: a workload identity/scope (`catalog.read:service`)
or mTLS policy that Catalog can verify, per ADR 0003 ("service-to-service identity
and end-user authorization are distinct").

## CR-B1-5 Event `catalog.definition-published.v1`

Envelope as existing (`eventId, eventType, schemaVersion, producer, occurredAt,
correlationId, aggregateVersion, data`), `data = { revision, effectiveFrom,
definitionsFingerprint }` — no labels, no personal data. Catalog will then write
it to its existing outbox in the publish transaction. No event is emitted before
the contract and parser exist.

## CR-B1-6 Readiness promotion

`scripts/check-layers.mjs` and `generate-service-shells.mjs --check` require
`BUSINESS_READY = false`. Promotion to ready requires an E-owned rule change
after CR-B1-1…3 are accepted and real Identity-to-Catalog acceptance passes.

## CR-B1-7 Dependency (no change needed now)

Catalog already depends on `pg`, `@prisma/*`, Nest and `@carwash/service-kit`.
It does not need new packages for B1. If E prefers local JWT verification over
the per-request Identity session decision, add `@carwash/security-kit` to
`services/catalog/package.json` + lockfile (E-owned).

## CR-B1-8 Source inventory registration (blocks CI `static` on this PR)

`tests/parallel/E/status.test.mjs` derives each owner's persistence models from
its Prisma schema and compares them with the E-owned
`architecture/implementation-status.json`. Lane B may not edit that file. Exact
delta requested for `services[id=catalog].persistenceModels` (nothing else
changes; `businessApi` stays as derived from `service-catalog.json`):

```json
["ServiceMarker", "FoundationProbe", "OutboxMessage", "CatalogPublicationLock",
 "CatalogRevision", "CatalogVehicleCategory", "CatalogPackage", "CatalogAddon",
 "CatalogPackageCategory", "CatalogAddonCategory", "CatalogPackageAddon",
 "CatalogIdempotencyReceipt", "CatalogAuditEvent"]
```

Until E applies it (in its own PR, or by co-authoring a merge candidate), the
`static` job — and the release gate that aggregates it — fails on this PR by
design. It is a registration gap, not a behaviour failure.

---

# P06-B1 requests (catalog.v1 provider)

Catalog now serves the published `catalog.v1` routes and emits the published
`catalog.definitions-published.v1`. The items below are what Lane E still owns.
None of them blocks the Catalog code; each blocks integrated acceptance.

## CR-B-P06-01 First publication: `expectedCatalogRevision: 0`

`parsePublishCatalogRequestV1` uses `parseRevision` (>= 1), so the very first
publication cannot be expressed by a contract-conforming client. Catalog
accepts `0` only while no catalog exists (any other `0` is a 412
`REVISION_CONFLICT`). Requested change, `packages/contracts/src/catalog/v1.ts`:

```ts
expectedCatalogRevision: integer(v.expectedCatalogRevision, '$.expectedCatalogRevision', 0, MAX_REVISION),
```

plus the matching `PublishCatalogRequestV1` doc comment ("0 = no catalog yet")
and `docs/contracts/catalog.v1.openapi.json` `minimum: 0`. The same gap exists
in `pricing.v1` `expectedPriceBookRevision`.

## CR-B-P06-02 Gateway `customer.catalog` upstream

`packages/contracts/src/gateway.ts` route `customer.catalog` points at
`/internal/v1/catalog/packages`, which catalog.v1 does not define. Requested:
`upstream: '/internal/v1/catalog/definitions'` (public, GET). The Gateway should
forward only `PUBLISHED` items to customers if it filters at all; the owner
returns the complete snapshot (retired included) by contract design.

## CR-B-P06-03 `@carwash/contracts` dependency for Catalog

Add `"@carwash/contracts": "workspace:*"` to `services/catalog/package.json`
and the lockfile so the local restatement in
`services/catalog/src/application/catalog-v1-wire.ts` can be replaced by the
published parsers. Until then `tests/production/B/catalog-v1-provider.test.mjs`
is the parity guard.

## CR-B-P06-04 Broker topology and relay start for `washgo.catalog.events`

Rows are written to `app.outbox_message` (exchange `washgo.catalog.events`,
routing key `catalog.definitions-published.v1`). Declare the exchange/bindings
and the catalog relay deployment; until then rows stay pending, which is safe
(no consumer depends on them yet).

## CR-B-P06-05 Source inventory registration and legacy helper removal

`tests/parallel/E/status.test.mjs` fails until
`architecture/implementation-status.json` `services[id=catalog].persistenceModels`
becomes:

```json
["ServiceMarker", "FoundationProbe", "OutboxMessage", "CatalogPublicationLock",
 "CatalogRevision", "CatalogVehicleCategory", "CatalogPackage", "CatalogAddon",
 "CatalogPackageCategory", "CatalogAddonCategory", "CatalogPackageAddon",
 "CatalogIdempotencyReceipt", "CatalogAuditEvent", "CatalogV1Publication",
 "CatalogV1DefinitionIdentity", "CatalogV1Definition"]
```

Separately, `services/catalog/src/domain/quote.ts` (unconnected money helper in
a service that never owns money) can be deleted once E removes its references:
`architecture/service-catalog.json` legacyPrototypeLocations,
`architecture/parallel-ownership.json`, `scripts/ownership/catalog.mts`,
`tsconfig.domain.json` and `tests/domain.test.mjs`.

## CR-B-P06-06 Real `catalog.publish` holders

Identity already lists `catalog.publish`. Named staff holding it in each
environment are an owner/E decision; without one, every publish is 403.
