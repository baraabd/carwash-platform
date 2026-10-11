# Contract request to Lane E — Pricing v1 (from P01-B2)

Status: **SUBMITTED, not accepted**. Lane B does not edit shared contracts, event
contracts, Gateway, Identity, root dependencies, lockfiles, CI or readiness
guards. Lane B consumes only E's merged, versioned result.

Provider implementation: `services/pricing` at the head of
`prod/p01-b-implement-catalog-and-pricing-production-providers-b2-pricing`.

## CR-B2-1 HTTP contract `pricing.v1` in `@carwash/contracts`

```ts
interface MoneyV1 { amountMinor: string; currency: string } // canonical integer minor units
interface PriceRateV1 { kind: 'PACKAGE' | 'VEHICLE' | 'ADDON'; definitionId: string; amountMinor: string }
interface PriceVersionViewV1 { version: number; effectiveFrom: string; effectiveUntil: string | null; publishedAt: string;
  catalogRevision: number; policyRevision: string; currency: string; minorUnitExponent: number; ratesFingerprint: string; rates: PriceRateV1[] }
interface PricePublishCommandV1 { expectedVersion: number; effectiveFrom: string | null; catalogRevision: number; rates: PriceRateV1[] }
interface QuoteCommandV1 { catalogRevision: number; categoryId: string; packageId: string; addonIds: string[] }
interface QuoteLineV1 { kind: 'PACKAGE' | 'VEHICLE' | 'ADDON'; definitionId: string; included: boolean; amount: MoneyV1 }
interface QuoteViewV1 { quoteId: string; status: 'USABLE' | 'EXPIRED'; evaluatedAt: string; issuedAt: string; expiresAt: string;
  priceVersion: number; catalogRevision: number; policyRevision: string; currency: string; minorUnitExponent: number;
  selection: QuoteCommandV1; lines: QuoteLineV1[]; subtotal: MoneyV1; total: MoneyV1; durationMinutes: number; inputFingerprint: string }
```

Routes under `/internal/v1/pricing`: `GET /prices`, `GET /price-versions`,
`POST /prices`, `POST /quotes`, `GET /quotes/:id`, `POST /quotes/:id/validate`.
Reason codes: `REQUEST_INVALID`, `IDEMPOTENCY_KEY_INVALID`, `AUTH_REQUIRED`,
`AUTH_FORBIDDEN`, `AUTH_UNAVAILABLE`, `NOT_FOUND`, `PRICES_NOT_PUBLISHED`,
`IDEMPOTENCY_CONFLICT`, `VERSION_CONFLICT`, `RATES_INVALID`,
`CATALOG_REVISION_UNKNOWN`, `CATALOG_REVISION_MISMATCH`, `SELECTION_INVALID`,
`AMOUNT_LIMIT_EXCEEDED`, `QUOTE_EXPIRED`, `QUOTE_SELECTION_MISMATCH`,
`POLICY_UNAVAILABLE`, `UPSTREAM_UNAVAILABLE`, `EFFECTIVE_FROM_*`,
`PRICE_PRECEDES_CATALOG`. The Gateway envelope needs the allowlisted reason
extension requested in the W01 packet.

Consumers: Booking (validate before confirmation, pin quote ID/snapshot), Billing
(obligation amount from the pinned quote), customer/admin web via Gateway.

## CR-B2-2 Identity permissions

Add `pricing.publish` (proposal: `finance`, `super-admin`). Quoting currently uses
the existing `bookings.create:self`; E may instead define `pricing.quote:self`.
Guest quoting needs the guest capability decision (B-15).

## CR-B2-3 Catalog read for Pricing (depends on CR-B1-1)

After `catalog.v1` is published: Pricing will implement `CatalogRevisionReader`
over `GET /internal/v1/catalog/definitions/:revision` using E's published types,
replacing `PendingCatalogContractReader`. Until then price publication returns
503 `UPSTREAM_UNAVAILABLE` by design.

## CR-B2-4 Service identity and dependency

Service-to-service identity/scope for Pricing → Catalog (`catalog.read:service`,
see CR-B1-4). If that requires `@carwash/security-kit` or `@carwash/contracts`
in `services/pricing/package.json`, E owns the package/lockfile change.

## CR-B2-5 Shared technical client

Catalog and Pricing each contain an identical `IdentitySessionAuthority` adapter
(current-session decision, fail-closed). Request: move it into a versioned
technical package (`@carwash/service-kit` or `@carwash/security-kit`) so owners
consume one implementation. No business rule is involved.

## CR-B2-6 Events

`pricing.price-published.v1` `data = { version, catalogRevision, policyRevision,
effectiveFrom, ratesFingerprint }` and `pricing.quote-issued.v1`
`data = { quoteId, priceVersion, expiresAt }` (no owner, no amounts, no PII;
consumers read the owner API). Pricing has no outbox table or
`@carwash/platform-messaging` dependency yet; on acceptance B will add an
additive outbox migration and write events in the same transaction.

## CR-B2-7 Readiness and policy configuration

Readiness promotion (E-owned guard) after CR-B2-1…3 and real integration pass.
Production values for `PRICING_CURRENCY_POLICY` (B-03) and
`PRICING_QUOTE_TTL_SECONDS` (B-05) must come from recorded owner decisions;
B will not supply defaults.

## CR-B2-8 Source inventory registration (blocks CI `static` on this PR)

`tests/parallel/E/status.test.mjs` derives persistence models from the Prisma
schema and compares them with the E-owned `architecture/implementation-status.json`.
Exact delta requested for `services[id=pricing].persistenceModels`:

```json
["ServiceMarker", "PricingPublicationLock", "PriceVersion", "PriceRate", "Quote",
 "QuoteLine", "PricingIdempotencyReceipt", "PricingAuditEvent"]
```

Until E applies it, the `static` job and the aggregating release gate fail on this
PR by design (registration gap, not a behaviour failure).

# P06-B2 additions (Pricing now serves the published `pricing.v1`)

Submitted with branch
`prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b2-pricing-v1`.
Pricing does not wait on any of these to behave correctly; each one is fail-closed
until E answers.

## CR-B-P06-PRC-01 Publish permission name mismatch

`pricing.v1.publishPriceBook` declares `permission:pricing.prices.publish`, but
Identity (`IDENTITY_PERMISSIONS`, super-admin only) issues `pricing.publish`.
Pricing enforces the CONTRACT name, so no real session can publish a price book
today (proven by `pricing.http.spec` — `legacy-admin` gets 403). Request: E aligns
one side (rename the contract access to `permission:pricing.publish`, or add
`pricing.prices.publish` to Identity), and records which roles hold it.

## CR-B-P06-PRC-02 `expectedPriceBookRevision` semantics

The contract parses it with `parseRevision` (>= 1), so "the revision currently in
force" cannot express the first publication (there is none). Pricing implements
it as "the revision this publication creates" (head + 1; 1 for the first book),
a compare-and-set on the linear chain. Request: E documents this meaning in
`pricing/v1.ts`, or changes the contract (minor) to allow 0.

## CR-B-P06-PRC-03 Staff read of the price book in force

The admin finance console needs to read the current book (entries, revision,
catalog revision) to edit and republish it. `pricing.v1` has no such route.
Request (additive, minor): `getPriceBook: { method: 'GET', path: '/price-books/current',
access: 'permission:pricing.prices.publish' }` returning
`{ priceBookRevision, currency, catalogRevision, policyRevision, publishedAt, entries: PriceBookEntryV1[] }`.
Pricing will implement it on acceptance; nothing is served outside the contract now.

## CR-B-P06-PRC-04 Workload grant for Booking -> `validateQuote`

Pricing authorizes `service:pricing.quote.validate` with the shared P04-E3
primitive (`PRICING_SERVICE_CLIENTS`, digests only). Request: E provisions the
Booking client credential and digest in the deployment secret store.

## CR-B-P06-PRC-05 Pre-routing error envelope

`bootstrapService` installs `AppExceptionFilter` globally after the owner's
application is created, so body-parser refusals (malformed/oversize JSON) are
rendered in the legacy service-kit envelope (`{error:{code,message,correlationId,status}}`)
instead of `ApiErrorEnvelope`. Route errors already use the contract envelope.
No internal text is reflected. Request: service-kit renders `ApiErrorEnvelope`
or lets an owner supply its filter.

## CR-B-P06-PRC-06 Source inventory registration (blocks CI `static` on this PR)

Exact delta for `architecture/implementation-status.json`
`services[id=pricing].persistenceModels` (schema order):

```json
["ServiceMarker", "PricingPublicationLock", "PriceVersion", "PriceRate", "Quote",
 "QuoteLine", "PricingIdempotencyReceipt", "PricingAuditEvent", "PriceBook",
 "PriceBookEntry", "PricingQuote", "PricingQuoteLine", "PricingAuditRecord"]
```

## CR-B-P06-PRC-07 Events (unchanged from CR-B2-6, renamed fields)

`pricing.price-published.v1` should carry `{ priceBookRevision, catalogRevision,
policyRevision, entriesFingerprint }` (no amounts). No outbox row is written until
E registers the event; Pricing has no `@carwash/platform-messaging` dependency.
