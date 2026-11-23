# W02-B — Contract delta requests to Lane E and affected owners

Status: **PROPOSED / UNACCEPTED; dependent implementation BLOCKED**.
Observed source: `3db1afdd04c6ec65a38ca83f3993c964a1bf7587` on 2026-10-05.
`architecture/parallel-contract-release.json` still records `BASE_W02: null`,
`acceptedNextWaveContracts: []`, and B's merged W01 packet as review-pending.
These requests neither publish contracts nor expire E's bootstrap leases.
No service source, shared DTO, dependency manifest or registry is changed here.

## Version and review boundary

The existing W01 candidates are [W02_CONTRACT_PACKET.md](../W01/W02_CONTRACT_PACKET.md)
and [w02-contracts.schema.json](../W01/w02-contracts.schema.json), proposal revision
`w01-b-finance-proposal/0.1.0`. Their closed schemas cannot accept these fields
without a reviewed revision. Request E publish the revised, owner-reviewed shapes
as new business V1 contracts only if no business V1 has since been accepted;
otherwise use a new major or an explicit compatibility adapter. E assigns actual
package versions and the common base. No future package version is asserted here.

Current published packages remain `@carwash/contracts@0.0.2`,
`@carwash/event-contracts@0.0.2`, and skeleton `@carwash/api-clients@0.0.1`.
HTTP exports cover Identity/Gateway only; event exports cover the nonfinancial
foundation probe and contract-only BookingConfirmedV1. Preserve their validators.

## CR-B-01 — Catalog revisions, retirement and descriptions

Owners: B provider; E publication/routing; A and D consumers.
W01 `$defs/CatalogSnapshot`, `CatalogDefinitionSet`, `Package`, `Addon` and
`VehicleCategory` have no lifecycle/retirement or description-version fields.
The state proposal promises retirement without its wire/read semantics.

Request a closed revision representation with these **candidate** fields:

| Field                                | Proposed type and rule                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalogRevision`                    | Immutable opaque `Revision` identifying the complete publication; distinct from event sequence.                                                              |
| `definitionId`, `definitionRevision` | Stable opaque definition ID and immutable definition revision; label changes never change identity.                                                          |
| `kind`                               | `PACKAGE`, `ADDON` or `VEHICLE_CATEGORY`; closed enum.                                                                                                       |
| `state`                              | `PUBLISHED` or `RETIRED` in a published snapshot; retirement appends a new revision. Drafts remain private if separately accepted.                           |
| `description`                        | `{ labelAr: string, descriptionAr: string, featuresAr: string[] }`; exact bounds and field applicability published by E. No invented text or English design. |
| `publishedAt`, `effectiveAt`         | Valid canonical UTC instants; first provider proposes immediate activation. Future scheduling needs its own approved worker/transition contract.             |
| `retiredAt`                          | UTC instant or `null`, consistent with state; never a replacement for an immutable historical description.                                                   |
| Compatibility/duration               | Existing typed category/add-on references and integer minute fields retained, with unique IDs and valid references. No prices in Catalog.                    |

Request `GET /internal/v1/catalog/definitions` return the currently effective
publication's eligible definitions; `GET /internal/v1/catalog/revisions/:id`
return an immutable historical publication. E must accept revision-path matching
for opaque revisions, not assume the existing UUID resource matcher accepts them.
Historical visibility is not eligibility for a new quote. Never reuse a retired
definition ID for a different service or mutate an earlier publication.

Request full-publication command `{ schemaVersion, expectedRevision, definitions,
reasonCode }`, with `expectedRevision: Revision | null` meaning exactly no prior
publication for `null`. The owning transaction compares the active pointer,
validates all references, appends publication/audit/outbox/receipt, and advances
the pointer once. Retirement uses this publication boundary, not hard deletion.
Restore means a new validated publication, never rewriting a retired revision.

Audit stays an authorized owner resource: `{ auditId, actorRef, operationId,
previousRevision, resultingRevision, reasonCode, committedAt }`; public Catalog
reads exclude actor/audit details. Persist the verified actor, not a browser role.
Publication returns `{ operationId, catalogRevision, committedAt, snapshot }`;
same-key replay returns its original outcome, while current reads may be newer.

Conformance: competing expected-revision writes have one winner; malformed/orphan
definitions and incompatible included add-ons have no effect; restart preserves
every revision; retired inputs fail new quote eligibility and old descriptions
remain readable under approved authorization. Preserve historical quote policy
explicitly rather than silently revoking all quotes on retirement.

## CR-B-02 — Quantities, immutable line evidence and delegated beneficiaries

Owners: B Pricing; E Identity/contracts; A customer/vehicle/Geo; C Booking; D admin.
W01 `$defs/QuoteCommand` accepts only selected IDs; `$defs/LineItem` lacks quantity,
unit rate, description revision and adjustment evidence. `$defs/QuoteSnapshot`
has one `owner`, without distinct actor/beneficiary or delegated command semantics.

Request closed selection entries `{ definitionId, quantity }`, where `quantity`
is a positive safe integer subject to an approved kind-specific maximum. Zero,
fractional, unsafe and excessive quantities reject. E/B/Product must reconcile
this shape with the frozen single-vehicle/package journey; it creates no bulk UI
or new product. Reject duplicate add-on IDs before canonical sorting.

Request each immutable quote line record `{ lineId, kind, definitionId,
definitionRevision, descriptionSnapshot, quantity, unitAmountMinor,
lineSubtotalMinor, included, adjustments, lineTotalMinor }`. Description snapshot
is owner-resolved, never client-supplied. `adjustments` contains closed entries
`{ kind: DISCOUNT | FEE | TAX, policyRef, amountMinor }`, with explicit
decrease/increase meaning and calculation order accepted by E/B.
All amount values are canonical nonnegative minor-unit strings. Included add-ons
retain their identity and zero incremental charge without double charging.
Preserve the vehicle surcharge as its own line and its additional duration.

Retain quote-level currency/exponent, Catalog/price/policy/zone revisions,
subtotal/discount/fee/tax/total, issue/expiry and duration. The provider verifies
line equations and aggregate totals using exact integers and approved rounding;
syntax validation is insufficient. Reject client rates/totals/discounts/taxes.

Ordinary quote requests derive beneficiary from the verified account/guest.
Propose a distinct admin command with `beneficiaryRef: { kind: ACCOUNT | GUEST,
id: UUID }` and `delegationRef: UUID`; E defines proof, scope and revocation.
Pricing derives `actorRef` from verified credentials and checks current authority
for that beneficiary. Persist actor/beneficiary/delegation provenance in protected
quote/audit records. Customer quote views disclose only their authorized snapshot,
not another actor's private session/grant details. Admin permission permits no
arbitrary rate override. Existing optional plates remain optional.

Conformance: guest/account isolation; unauthorized beneficiary substitution;
expired/revoked delegation; actor distinct from beneficiary; same-key replay and
conflict bind beneficiary and normalized selections; restart and price edits never
change prior line evidence, total or expiry. No fake customer account is created.

## CR-B-03 — Identity authorization, errors and durable replay

Owner: E; B independently verifies owner access. Existing Identity V1 permissions
have no Catalog/price publish, quote ownership, guest capability or delegation.
Request grants `catalog.publish`, `pricing.prices.publish`, `pricing.quotes.self`,
`pricing.quotes.on-behalf` and scoped service reads, with E's exact actor/scope
mapping. These names are candidates; `finance`/`super-admin` alone grants nothing.

Request the guest validation result `{ guestId, capabilityId, scope,
authRevision, expiresAt }` and a live authorized validity/revocation check.
E owns the signed transport, audiences, CSRF/abuse controls and claim/transfer
policy. Never trust `x-auth-*`, a supplied owner ID or payload `producer` alone.
Check current authorization before returning a retained sensitive replay result.

Publish mutation key syntax `[A-Za-z0-9_-]{16,128}` and receipt uniqueness scope
`(owner service, contract major, verified actor, operation, idempotency key)`.
Fingerprint contract/version, beneficiary, normalized body and expected revision;
exclude secrets and volatile transport IDs. Same key/different body returns 409;
same key/same body returns the original recorded result, even after quote expiry,
without extending expiry. Terminal claimed business rejections are replayable;
malformed/unauthorized requests reject before a receipt; precommit transient
failures roll back. TTL/tombstones/deadlines remain B-05 owner decisions.

D's W01 common command proposal additionally requires `commandId`, scopes keys
by scope/target, and permits a 202 receipt during concurrent replay. Request E/B/D
accept one explicit command metadata/uniqueness/replay-status contract. B proposes
binding beneficiary/target in the fingerprint rather than allowing a reused key
to create another effect by changing target. Add-on order is canonical sorted
selection order; D's general order-preserving array rule needs this named override.

Request allowlisted reasons `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`,
`SELECTION_INVALID`, `QUOTE_EXPIRED`, `QUOTE_REVOKED`, `POLICY_UNAVAILABLE` and
authorization/dependency failures. Existing Gateway errors are generic; E must
publish an explicit reason extension or documented generic-code/state-refetch
adapter. Do not forward arbitrary upstream prose or replace Identity V1 errors.

## CR-B-04 — Gateway and Configuration compatibility

E owns Gateway; D owns Configuration; A owns Geo; B validates finance applicability.
Current `customer.catalog` maps protected `GET /customer/packages` to Catalog
`/packages` with `profile.read:self`. Non-auth routes still require verified
identity through `verifiedHeaders`; simply deleting that grant does not enable
public/guest access. Request a bounded public Catalog projection route, separate
authorized history/admin routes and Pricing issue/read/on-behalf aliases. E must
add Pricing to owner/origin allowlists and publish exact route/headers/size/deadline
rules; retain existing route behavior or provide a reviewed transition adapter.
Mutation retries remain owner-idempotent, never blind Gateway retries.

W01 B uses opaque string `Revision`, `minorUnitExponent` and
`currencyPolicyRevision`; D uses safe-integer `Revision`, `exponent` and
`currencyPolicyVersion`, with Configuration `previousVersion: number`.
Both now propose canonical integer minor-unit strings; there is no major-unit
decimal conversion to assume. Request E/D/B publish one interoperable Money shape
and typed owner references; preserve separate entity revision, policy publication
version and event sequence. Explicit adapters must reject lossy coercion.

Request closed Configuration finance-policy reads binding `{ marketId, namespace,
configurationId, version, effectiveAt, contentHash, approvedDecisionRefs }` to the
accepted currency/exponent, amount/quantity bounds, rounding boundaries/order,
tax/fee policy refs, quote expiry/revocation and replay policy. B validates exact
policy/version/hash applicability; D publishes policy metadata, not package rates.
A supplies authoritative `serviceZoneId`/revision/eligibility via accepted Geo.
Do not infer zones from address text or prototype samples. Missing/conflicting
policy fails closed; no implicit currency, zero tax, rate, tie rule or TTL.

## CR-B-05 — Events, clients, dependencies and acceptance sequence

E must settle Catalog event naming: F001 reserves `catalog.package-updated.v1`,
while W01 B proposes `catalog.definition-published.v1`; neither is published.
Request one registered publication event with closed data `{ catalogRevision,
previousCatalogRevision, effectiveAt }` and owner scope/aggregate identity chosen
explicitly. Retirements are new publications discoverable through that revision.
Pricing publication/quote events likewise need accepted scoped revision/ID refs.
Keep the exact existing envelope fields: `eventId`, `eventType`, `schemaVersion`,
`producer`, `occurredAt`, `correlationId`, `aggregateVersion`, `data`. Never add
actor/contact/plate/proof/complete quote data or mutate BookingConfirmedV1.

Request E publish typed Catalog/Configuration/Geo/Identity clients with strict
parsers, bounded responses/timeouts and authenticated owner reads. Catalog and
Pricing need approved contracts/security/client dependencies; Pricing needs the
approved messaging dependency if its transactional outbox uses that foundation.
E owns package manifests, lockfiles, exports, runtime origins, service/broker ACLs,
worker process wiring, image/CI targets and allocated test-resource manifests.
An allocator's names do not provision DBs/roles/queues; verify actual resources.

Provider conformance requires real owned PostgreSQL upgrade/constraints/rollback,
current Identity HTTP authorization, concurrent publication/replay and immutable
restart persistence. Registered event use additionally requires real broker
producer ACL, outbox crash/replay and consumer inbox/no-regression/gap recovery.
Accept Catalog first, Pricing against merged real Catalog/policy prerequisites,
then customer/admin/Booking consumers against accepted providers. Full parent
acceptance requires actual Catalog-to-Pricing and customer quote journeys on E's
serialized candidate; local fixtures remain component evidence only.

Required release response from E: exact accepted contract IDs/versions and schemas,
review records per affected owner, actual package/dependency changes, producer
sequence and gates, isolated resource allocation, and verified full `BASE_W02`.
Unknown money bounds/rounding/TTL, retirement price-honoring, quantity policy,
delegation/guest semantics and configuration compatibility remain visible blockers.
