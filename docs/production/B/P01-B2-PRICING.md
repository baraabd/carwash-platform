# P01-B2 — Pricing production provider

Status: **implemented and locally verified; review required; INTEGRATION_PENDING**.
Readiness remains 503. Not production-ready, not deployed, not integrated. Parent
index: `docs/production/B/README.md` (added by B1, PR #90).

Independence from B1: this branch is based on `main`, imports nothing from
Catalog, never reads `cw_catalog`, and does not consume the unpublished
`catalog.v1` contract. Catalog data enters only through the `CatalogRevisionReader`
port, whose production binding fails closed until E publishes the contract.

## Architecture

| Layer          | Files                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| domain         | `money.ts`, `currency-policy.ts`, `catalog-snapshot.ts`, `price-version.ts`, `quote.ts`   |
| application    | `pricing.service.ts`, `pricing-errors.ts`, `canonical-json.ts`                            |
| ports          | `pricing.ports.ts` (repository/UoW, CatalogRevisionReader, PolicyProvider, Clock, Ids, Hasher, AccessAuthority) |
| infrastructure | Prisma repository, Identity session adapter, env policy provider, pending catalog reader, system adapters |
| transport      | `transport/http/pricing.controller.ts`                                                    |

## Money and policy

- `Money` = `bigint` minor units + ISO-style currency; wire `amountMinor` is a
  canonical integer string (`^(0|[1-9][0-9]{0,17})$`); JSON numbers are rejected.
- Proven exact beyond 2^53 on PostgreSQL (`450000000000035001`).
- Currency, minor-unit exponent and maximum come from `PRICING_CURRENCY_POLICY`
  with an immutable `revision`. B-03 is OPEN, so nothing is defaulted: without it
  publication and quoting return `503 POLICY_UNAVAILABLE`. Every price version and
  quote records `policyRevision`, `currency` and `minorUnitExponent`; if the
  configured policy revision differs from the version in force, quoting is refused
  until prices are republished under the new policy.
- v1 performs no division, so no rounding rule is applied or invented. Discounts,
  promotions (B-10), zone/travel fees and tax (B-04) are not computed; the DB
  enforces `total = subtotal` for v1 quotes.

## Price versions

`POST /prices` `{ expectedVersion, effectiveFrom|null, catalogRevision, rates[] }`
with `Idempotency-Key` and `pricing.publish`:

1. strict parse; rates canonicalised by (kind, id); amount ≤ policy max;
2. replay/conflict check against the durable receipt (no upstream call on replay);
3. read the exact catalog revision through the port **before** the transaction;
   unknown → 422, unavailable → 503 (no receipt, safe to retry with the same key);
4. validate full coverage (every package, category and chargeable add-on; no rate
   for unknown or included-only definitions);
5. one transaction: lock head → re-check receipt → plan (chain, no retroactivity,
   strictly increasing effective time, not before the catalog revision) → insert
   version + rates + catalog view → receipt → audit.

## Quotes

`POST /quotes` `{ catalogRevision, categoryId, packageId, addonIds[] }` with
`Idempotency-Key` and `bookings.create:self`:

- Server time selects the price version in force. If its catalog revision differs
  from the client's → `409 CATALOG_REVISION_MISMATCH` (client refetches catalog).
- Compatibility against the stored catalog view: package allows category, add-on
  allows category, add-on is optional (charged) or included (zero line, never
  double-charged); otherwise `422 SELECTION_INVALID`. Duplicate IDs → 400.
- Lines: PACKAGE, VEHICLE (always present, may be 0), ADDON lines. Duration =
  package + category extra + optional add-ons.
- `expiresAt = min(issuedAt + TTL, next scheduled version's effectiveFrom)`.
- Idempotency: receipt keyed by (owner, operation, key) committed with the quote.
  A concurrent same-key race loses on the unique key and replays the winner.
  Replays return the original quote ID, snapshot and expiry; only `status` is
  re-evaluated. Mismatch/selection rejections are durable receipts.
- `GET /quotes/:id` and `POST /quotes/:id/validate` are owner-only (404 otherwise).
  Validation recomputes the input fingerprint (owner, price version, policy,
  selection) and refuses expired quotes; it never mutates or extends a quote.

## Database (migration `20261007100000_p01b_pricing_quotes`)

Additive (expand-only). Tables: `pricing_publication_lock`, `price_version`,
`price_rate`, `quote`, `quote_line`, `pricing_idempotency_receipt`,
`pricing_audit_event`. Proven on PostgreSQL 16.10:

- linear chain CHECK, unique `previous_version`/`effective_from`, increasing
  `effective_from` trigger, non-retroactive CHECK;
- non-negative BIGINT amounts, kind vocabulary, ID format, currency/exponent/policy
  format, `expires_at > issued_at`, `total = subtotal` (v1), included lines free;
- **deferred constraint trigger** at COMMIT: a quote must have exactly one PACKAGE
  and one VEHICLE line, its lines must sum to its subtotal, and it must match its
  price version's catalog revision, policy revision, currency and exponent;
- rates/lines insertable only by the transaction that created their parent;
- UPDATE/DELETE rejected on every table for every role.

Rollback: redeploy the previous image; the additive tables stay unused. No
destructive down-migration; dropping needs a separate reviewed data plan.

## Security and privacy

Deny by default; current Identity session decision on every request; `x-auth-*`
hints ignored; non-enumerating 404 for foreign quotes. Quotes contain no contact,
plate or address data — only the pseudonymous owner subject. Logs carry status,
replay flag and rejection code only.

## Tests

| Family | Command | Real/mocked |
| --- | --- | --- |
| Domain (money, policy, rates, plan, selection, quote, expiry) | `node --test services/pricing/dist-tests/test/pricing.domain.spec.js` | pure |
| HTTP auth/object access, policy/upstream fail-closed, idempotency, expiry, mismatch, concurrency | `node --test services/pricing/dist-tests/test/pricing.http.spec.js` | real Nest HTTP + real Identity adapter; Identity stub; in-memory repository; fake catalog reader |
| Nest runtime/readiness | `pnpm --filter @carwash/pricing test:runtime` | real listener, no DB |
| PostgreSQL | `node scripts/production/B/postgres-acceptance.mjs --service pricing` | **real PostgreSQL 16.10** as `cw_pricing_app`; Identity stub; fake catalog reader |

Not claimed: RabbitMQ (no events until E publishes `pricing.*.v1`), real
Catalog-to-Pricing contract, real Identity, Gateway, browser, production.
