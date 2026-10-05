# W02 finance contracts submitted to Lane E

Proposal revision: `w01-b-finance-proposal/0.1.0`. Proposed wire contracts: V1.
**Not accepted, published or implemented.** Consumed foundation packages remain
`@carwash/contracts@0.0.2` and `@carwash/event-contracts@0.0.2`.
E determines the accepted package versions and common base; this proposal does
not assign future package versions or modify reserved exports/registries.

The accompanying JSON Schema is a candidate structural specification. Business
authorization, current policy/revisions, money relationships, expiry, unique
effects and cross-record constraints require actual owner/provider tests. Schema
validation does not establish those facts or service readiness.

## Prerequisite and child acceptance order

1. **W02-E-GUEST-GATEWAY**: E publishes bounded guest/verified-principal transport,
   grants, Pricing owner/origin/routes, safe errors, CSRF and accepted packages.
   Guest ownership and Booking event compatibility require E/A/C agreement.
2. **W02-B-CATALOG**: owned DB/migrations, definition/revision HTTP authorization,
   compatibility, constraints, public/service-read boundaries and contracts;
   accept against actual E prerequisite and mandatory CI.
3. **W02-B-PRICING**: owned DB/migrations, actual merged Catalog/policy contracts,
   immutable quote, durable replay/conflict/outbox and real authorization tests.
4. **W02-A/C/D-FINANCE-CONSUMERS**: after providers merge, actual guest/customer
   quote journey and applicable admin editing against real owners, with design,
   browser/accessibility and state-flow evidence before each consumer merges.

Names are dependency proposals for E, not authorization to start more sprints in
W01. Provider fixture conformance cannot close a consumer/integration gate.
Parent remains integration-pending until combined real journeys pass. All
children use E's accepted base and latest-target candidate process, never a
moving unmerged peer branch. Resolve active heavy-test/resource slots with E.

## Actors and ownership

Propose server-derived owner `ACCOUNT { id }` or `GUEST { id }`. E must accept the
guest session/capability, expiry, revocation and transfer/claim semantics. Neither
an owner ID nor privilege from a client body/header is trusted. Catalog public
reads have an explicit public mode; quote reads/commands require verified owned
capability; publisher commands require current accepted grants. Services verify
credentials/authorization independently, including object-level checks.

Existing account authentication/session revocation is reused. Current
`profile.read:self`, `billing.read` and `billing.refund` do not automatically
grant Catalog publish, price publish, collect cash or accept custody. Request
specific E-owned grants. Technician settlement approval remains forbidden.
Guest booking and optional plate remain requirements; quote issuance needs the
authoritative category, never a mandatory plate or fabricated customer account.

## Money, identifiers and time

Money wire value is `{ amountMinor, currency, currencyPolicyRevision }`, where
`amountMinor` is a canonical **integer decimal string in minor units**: no sign,
leading zero, exponent, fractional part, whitespace or JSON number. This follows
the existing architecture's minor-unit/BigInt approach and is distinct from a
major-unit string such as `1.25`. Currency precision, maximum amount and rounding
come only from an accepted immutable policy. No default exponent/currency/tax
or fixture prices are inferred from reference/helper values.

Quote response also records `minorUnitExponent`, `priceVersion`, `catalogRevision`
and `policyRevision`. Consumers render losslessly and retain the snapshot; a new
price/definition/policy never rewrites an existing quote/booking. Arithmetic is
exact integer arithmetic with approved rounding at specified boundaries.
Validate all sums and policy/currency alignment semantically at Pricing/Billing.

Definition IDs are stable opaque strings, not labels. Resource IDs follow the
proposed UUID vocabulary compatible with Gateway's current ID route matching;
revision references are immutable opaque strings. E must accept concrete syntax.
Timestamps use existing UTC millisecond form `YYYY-MM-DDTHH:mm:ss.sssZ`; validate
calendar validity and `issuedAt < expiresAt`. Market presentation/billing cutoff
uses accepted `Asia/Damascus` semantics, never client-local expiry authority.

## Candidate HTTP surfaces and schemas

The listed paths are proposals, not existing commands or executable acceptance
instructions. E approves exact Gateway aliases and OpenAPI discovery.

| Owner/operation       | Candidate internal path                    | Structural schema / authority                                                                        |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Catalog read active   | `GET /internal/v1/catalog/definitions`     | `CatalogSnapshot`; explicit public/service read, no amounts                                          |
| Catalog read revision | `GET /internal/v1/catalog/definitions/:id` | Immutable `CatalogSnapshot`; E settles revision-ID route syntax                                      |
| Catalog publish       | `POST /internal/v1/catalog/definitions`    | `CatalogPublishCommand` → `CatalogSnapshot`; current publisher + expected revision + audit           |
| Pricing publish       | `POST /internal/v1/pricing/prices`         | `PricePublishCommand` → `PriceSnapshot`; approved finance publisher/policy and real Catalog revision |
| Pricing issue quote   | `POST /internal/v1/pricing/quotes`         | `QuoteCommand` → `QuoteView`; verified account/guest ownership                                       |
| Pricing read quote    | `GET /internal/v1/pricing/quotes/:id`      | Same immutable `QuoteView` plus server-evaluated status                                              |

No arbitrary query forwarding is assumed. E either accepts bounded filter/query
syntax or serves a coherent snapshot without queries. Publication commands are
distinct from customer commands and must not be exposed by a role toggle alone.

Catalog snapshot contains categories and their extra duration, Arabic display labels,
packages, included add-ons, allowed categories, base/additional durations and explicit compatibility
relations. It contains **no authoritative price**. Validate unique IDs, all
references, included-addon membership and category compatibility in owned DB.
No approved English design is inferred from localized DTO flexibility.

Pricing command sends only package/category/add-on/zone IDs, Catalog revision and
optional promotion code. No owner, total, discount, unit price, tax or fee input.
Promotion acceptance stays fail-closed until approved; quoting does not reserve
or redeem usage. Included add-ons may be retained as selected IDs for approved
display, but response marks them included with zero incremental charge; never
double-charge. Reject duplicate requested IDs; canonicalize accepted unique IDs
in stable sorted order for fingerprinting. Do not silently strip unknown fields.

PriceSnapshot contains exact rates referencing Catalog with explicit PACKAGE,
VEHICLE surcharge and ADDON kinds. Preserve the approved bill's separate vehicle
surcharge and the category's extra duration; do not collapse them into a package
line that prevents the original breakdown. Validate rate-kind/definition/category
relationships at Pricing. Fee/tax/rounding rules
are resolved by a separately accepted policy revision. Price publication rejects
missing policies/unknown or inconsistent definitions. Quote contains server-derived
owner, immutable selected-service/zone revisions, rate/policy references, duration,
line totals, exact discount/fee/tax/subtotal/total, issue/expiry and evaluation time.
`status` is `USABLE`, `EXPIRED` or `REVOKED`, with policy-defined revocation.
This snapshot is not a capacity hold, Booking, payment or entitlement reservation.

## Idempotency, errors and timeout recovery

Require the existing Gateway key syntax `[A-Za-z0-9_-]{16,128}` for mutations.
Scope receipt uniqueness to `(verified actor/owner, operation, idempotency key)`;
publisher receipt ownership is the verified publisher, not a customer body field.
Fingerprint schema/version, canonical request fields and owner; ignore JSON key
ordering, sort selected unique add-on IDs, and preserve semantically significant
values/revisions. Do not fingerprint secrets or unverified forwarded headers.

Atomically persist quote/publication, terminal success receipt and Outbox. A
same-key identical concurrent request returns one effect and the same recorded
201/200 result. Same key/different canonical payload returns 409 with no effect.
Terminal domain rejection is retained with the fingerprint/result; malformed or
unauthorized requests reject before receipt creation. Transient failure before
commit may retry the same key; failure/response loss after commit replays the
original outcome. A quote replay preserves ID/snapshot/expiry even after expiry;
the read view evaluates current status. Replay never extends validity.

Idempotency TTL/tombstone lifetime is B-05; no cleanup may make an old mutation
key silently reusable. Publication revision conflicts are durable terminal
outcomes: changing expected revision requires a new reviewed command/key.
Timeout deadlines are E/B-approved, not invented seconds. Gateway performs no
automatic mutation retry. Unknown outcome → same key/request retry or authorized
resource read; no new-key optimistic resend, no production fixture fallback.

| HTTP    | Proposed safe reason                                                          | Required behavior                                                                |
| ------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 400     | `REQUEST_INVALID`                                                             | Unknown fields/key/ID/type or noncanonical amount; no mutation                   |
| 401/403 | `AUTH_REQUIRED` / `AUTH_FORBIDDEN`                                            | Missing/revoked credential or scope; sensitive check failure fails closed        |
| 404     | `NOT_FOUND`                                                                   | Missing/wrong-owner resource; non-enumerating                                    |
| 409     | `IDEMPOTENCY_CONFLICT`, `REVISION_CONFLICT`, `QUOTE_EXPIRED`, `QUOTE_REVOKED` | Distinguish key/state failure safely; client preserves draft and refetches owner |
| 422     | `SELECTION_INVALID`, `CURRENCY_UNSUPPORTED`, `PRECISION_UNSUPPORTED`          | Reject incompatible IDs/unsupported policy or scale; no currency fallback        |
| 503     | `POLICY_UNAVAILABLE`, `UPSTREAM_UNAVAILABLE`                                  | Missing approved policy/dependency; no fake price or settled state               |
| 504     | `UPSTREAM_TIMEOUT`                                                            | Outcome unknown; same-key recovery                                               |

The existing Gateway envelope has only generic codes. E must accept an allowlisted
reason extension with existing request/correlation IDs, or specify generic-code
plus owner-state refetch behavior. Do not forward arbitrary upstream messages or
assert these reasons already arrive in the UI. Schema `FinanceError` represents
only the candidate extension, not a replacement for current public contracts.

## Events, recovery and compatibility

Propose `catalog.definition-published.v1`, `pricing.price-published.v1` and
`pricing.quote-issued.v1`, with current exact envelope fields `eventId`,
`eventType`, `schemaVersion`, `producer`, `occurredAt`, `correlationId`,
`aggregateVersion`, `data`. Existing broker ACLs authenticate producers; a
payload's producer field alone does not. Payloads carry aggregate/revision refs
and expiry where applicable, never contact/plate/proof or full quote/customer data.
Quote event consumers must read an authorized owner contract for details.

Business state/receipt/Outbox commit together; Inbox/projection commit before ACK.
Enforce unique event IDs and conflict fingerprints; stale versions do not regress
state. Gaps trigger bounded owner-refetch/retry with durable error/DLQ visibility.
Unavailability delays truthful reconciliation rather than changing source money.

These finance v1s are new unpublished proposals. Do not change Identity V1 or
BookingConfirmedV1 fields/validators in place; strict consumers reject unknown
fields. E owns compatibility/version choice, accepted consumers and publication
barrier. A breaking mid-wave change requires a new accepted common base. All
compatibility fixtures are labeled; they cannot be production fallbacks.

## Provider/consumer acceptance requested

Catalog/Pricing require owned real PostgreSQL migration/upgrade/constraints,
permission and object-ownership HTTP tests, contract/schema negative cases,
concurrent command replay/conflict, Outbox/Inbox broker crash/replay where used,
and actual provider-consumer journey gates. Validate compatibility, included
add-ons, money precision/rounding, policy absence, revisions/expiry, large amounts,
guest isolation, unknown result and rebooking snapshots.

Concrete declarative cases are in `tests/parallel/B/W01/finance-acceptance.spec.json`.
No scenario has been executed as finance evidence. E's actual gate manifest,
explicit app commands and mandatory CI remain required. Root build/typecheck
alone do not cover all three apps. New Billing/Wallet/Subscription operations are
sequenced in `DEPENDENCY_HANDOFF.md`, not implied by W02 quote acceptance.
