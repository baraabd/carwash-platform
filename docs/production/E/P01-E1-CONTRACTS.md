# P01-E1 — First published business contract set

Lane E, child sprint 1 of P01-E. Base: `f875d31bf62b153b6d36ac7a607949f8c4e29389`
(tree `6177cc0112519b6b2c718e65c3b117f42a210bf5`).

## What this delivers

| Package | Version | Content |
| --- | --- | --- |
| `@carwash/contracts` | 0.0.2 → 0.1.0 | Shared wire conventions (`./common`) and eight owner contracts (`./<owner>-v1`) |
| `@carwash/event-contracts` | 0.0.2 → 0.1.0 | Envelope v2 (`./envelope-v2`) and ten business events (`./business-v1`) |
| `@carwash/api-clients` | 0.0.1 → 0.1.0 | Typed HTTP transport (`HttpClient`, `callRoute`) validating every response with the owner parser |

Status of every new contract is **`published-provider-pending`** (HTTP) or
**`published-producer-pending`** (events): the wire shape is published by Lane E
and versioned; no owner provider is accepted yet. Nothing here implements or
claims a working business endpoint.

### Owner contracts (HTTP)

| Contract | Owner (lane) | Consumers | Notes |
| --- | --- | --- | --- |
| `customer.v1` | Customer (A) | Booking, Pricing, admin | Profile, contact, saved addresses, immutable address snapshot (`service:customer.address-snapshot.resolve`) |
| `vehicle.v1` | Vehicle (A) | Booking, Pricing | Plate **optional**, no global uniqueness; saved or inline one-time snapshot |
| `geo.v1` | Geo (A) | Pricing, Scheduling, Booking | Serviceability decision; outage is `INDETERMINATE`, never `SERVICEABLE` |
| `catalog.v1` | Catalog (B) | Pricing, customer app, admin | Public published read; no prices |
| `pricing.v1` | Pricing (B) | Booking, Billing | Quote with exact bigint line/total arithmetic validated by the parser |
| `scheduling.v1` | Scheduling (C) | Booking, customer app | Availability (`Asia/Damascus`, half-open), holds, commit by Booking only |
| `workforce.v1` | Workforce (C) | Scheduling | Capacity resources only, no personal data |
| `configuration.v1` | Configuration (D) | Booking, Scheduling, Pricing | `booking.policy.v1`, `market.presentation.v1`; approver ≠ author is an owner rule |

Generated documents (from built code, drift-checked in CI):
`docs/contracts/<id>.openapi.json`, `docs/api/contract-registry.json`,
`docs/asyncapi/business-events-v1.yaml`, `docs/asyncapi/contract-registry.json`.

### Business events (envelope v2)

`customer.profile-updated.v1`, `customer.address-updated.v1`,
`vehicle.vehicle-updated.v1`, `geo.zone-updated.v1`,
`catalog.definitions-published.v1`, `pricing.price-book-published.v1`,
`pricing.quote-issued.v1`, `scheduling.hold-changed.v1`,
`workforce.eligibility-changed.v1`, `configuration.configuration-published.v1`.

Data carries opaque IDs, revisions and non-personal facts only. `booking.confirmed.v1`
(envelope v1) is unchanged; its guest-capable successor belongs to the Booking (P02) set.

## Resolved convention conflicts between lane requests

The A–D requests disagreed. Decisions and why:

| Topic | Requests | Decision |
| --- | --- | --- |
| Money | B `{amountMinor,currency,currencyPolicyRevision,minorUnitExponent}`, D `{…exponent,currencyPolicyVersion}`, C `{minorUnits,currency}` | `{currency, amountMinor: "<integer string>", scale}`. Closed currency list (`SYP`, `USD`, ISO 4217 scale 2). Scale is explicit and must equal the currency's; a consumer can never rescale silently. Policy revisions belong to Configuration, not every amount. bigint arithmetic helpers; 18-digit bound fits PostgreSQL BIGINT. |
| Revision | B opaque string; A/C/D positive integer | Positive safe integer ≤ 2^31−1 for entity revisions, `If-Match: "<n>"` for aggregate PATCH/archive, `expectedRevision` in the body for commands. Event `aggregate.version` = committed revision. Configuration `version` stays a distinct field. |
| Actor/principal | `{kind:'account'\|'guest',subjectId}` vs `ACCOUNT\|GUEST` vs `CUSTOMER\|GUEST` | `PrincipalRef {kind:'account'\|'guest', subjectId}`. Staff are accounts with permissions. Event actor adds `service` (service name) and `system` (null id). |
| Error envelope | A/C retryable+details; D fields+currentRevision; Gateway minimal | `{error:{code, reason, message, requestId, correlationId, retryable, retryAfterMs, issues[]}}`. `code` is a closed cross-service list; `reason` is an owner-allowlisted refinement (e.g. `QUOTE_EXPIRED`). `retryable` is derived from `code` and verified by the parser. `OUTCOME_UNKNOWN` is never retryable blindly. |
| Idempotency | same alphabet; scope/fingerprint/retention varied | Header `Idempotency-Key` `[A-Za-z0-9_-]{16,128}`. Scope = contract major + actor + operation + target. Fingerprint material = canonical (sorted, NFC) JSON of business body; no trace/CSRF/cookies. Same key+body → replay; different body → 409 `IDEMPOTENCY_CONFLICT`; in flight → 409 `IDEMPOTENCY_IN_PROGRESS` (retryable). **Retention is not decided here** — each owner documents it with its migration; the conflict (24h/7d vs 7d/30d vs 7d/90d) remains an owner/product decision. |
| Pagination | `{items,nextCursor,asOf}`, 20/50 vs max 100 | `{items, nextCursor, asOf}`, opaque cursor, default 20, max 100. |
| Time | canonical UTC; local dates with zone | Canonical `YYYY-MM-DDTHH:mm:ss.sssZ`; `LocalDate` + closed `BusinessTimeZone` (`Asia/Damascus`); intervals half-open. Owners inject the clock. |
| Event envelope | keep v1; B wants causation | v1 untouched. v2 adds `causationId`, W3C `traceparent`, `aggregate{type,id,version}`, PII-free `actor`. Producer identity still comes from broker ACLs. |
| Coordinates | EPSG:4326 6dp strings | Same; exact micro-degree range check; non-finite device readings refused, never clamped. |

## Route access model

Each route declares `access`: `public`, `principal` (account or guest acting on
its own records), `permission:<name>` (staff, issued by Identity) or
`service:<scope>` (workload identity; never exposed through the Gateway).
Mutations must be `idempotent` unless `safe` (a read-only POST). The structural
lint `contractProblems()` enforces this for every published contract.

The concrete scope/permission grants and the Gateway route table for these
contracts are delivered in P01-E3 (Gateway + Identity); they consume this
metadata and do not re-type it.

## Compatibility policy

`architecture/contract-surface.lock.json` records the reviewed surface.
`tests/production/E/contract-compatibility.test.mjs` fails when a locked route,
reason, error code, currency scale or event is removed or changed, and when the
surface grows without a reviewed lock update. Breaking changes ship as a new
major (`customer.v2`) beside the old one. Negative controls prove the gate fires.

## Evidence

Commands are recorded in the PR body with exact results. Dependencies: tests run
against the **built** packages; the client test uses a real `node:http` server and
Node's real `fetch` (no mocked transport). No database, broker or provider is
involved because no provider is implemented in this PR.

## Not in this PR / next

- P01-E2: runtime readiness (dependency vs business), deployable artifacts for 19 runtimes, status registry from source.
- P01-E3: Gateway routes/BFF for these contracts, public and guest auth modes, Identity guest session + recovery, service-to-service scopes.
- P01-E4: build/typecheck for all three apps in root/CI, ownership guard extensions.
- Owner providers (A–D) implement these contracts in their own services and add provider verification against the published parsers.
