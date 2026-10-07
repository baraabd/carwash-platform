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
