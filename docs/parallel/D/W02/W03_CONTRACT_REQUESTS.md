# W02-D — W03 contract requests

Status: **PROPOSED / no accepted wire or package version**. No W03 implementation
starts here. E publishes accepted schemas/clients and full `BASE_W03` at its
barrier; B/C and affected owners approve their semantics and producer tests.

Reuse `docs/parallel/D/W01/CONTRACT_PROPOSALS.md` CP-D-001/002/006 and its common
UUID/revision/UTC/scope/command/receipt/error definitions. Proposed `V1` type names
below identify candidate wire majors only. They do not select package semver or
amend strict deployed V1 Identity routes. E must resolve compatibility and every
required/optional/nullable field and reject unknown fields before acceptance.

## REQ-W03-D-01 — Configuration publication, adoption and audit

Authoritative policy/audit owner: D Configuration. Adoption owner: each consuming
domain. Search projection owner: D Reporting. Gateway/client publication: E.

Retain CP-D-002's candidate publication schema:

```ts
type ConfigurationPublishedV1 = {
  configurationId: UUID; marketId: UUID; namespace: string;
  version: Revision; previousVersion: Revision;
  contentHash: string; effectiveAt: UTC;
};
type ConfigurationAdoptionV1 = {
  consumerId: string; consumerContractVersion: string;
  configurationId: UUID; marketId: UUID; namespace: string;
  receivedVersion: Revision; appliedVersion: Revision | null;
  state: 'APPLIED' | 'PENDING' | 'REJECTED'; observedAt: UTC;
  problem: { code: string; retryable: boolean } | null;
};
type ConfigurationAuditRowV1 = {
  auditId: UUID; marketId: UUID; namespace: string;
  configurationId: UUID; version: Revision | null; draftRevision: Revision | null;
  operationId: UUID; action: string; outcome: string;
  actorRef: UUID | null; decisionRefs: string[]; contentHash: string;
  occurredAt: UTC;
};
```

`namespace`, consumer IDs, actions/outcomes/problem codes and hash algorithm need
closed registries from E/owners; arbitrary strings above are **not validators**.
The existing event envelope remains authoritative. Resolve aggregate identity per
market/namespace and monotonic revision, first-publication `previousVersion`,
unapplied semantics, event name, schema version and permitted producer identity.
An adoption timestamp/status cannot overwrite a newer applied version or make a
policy effective for a historical transaction.

Publication is a local Configuration command governed by CP-D-002's scoped
idempotency claim/fingerprint/receipt. Adoption is local consumer state plus its
inbox/outbox; no consumer writes Configuration's database. Event replay is keyed
by producer/aggregate/event identity with payload-conflict refusal, monotonic
version checks and authorized immutable snapshot/gap repair. E/owners must fix
replay lifetimes, validation receipt validity, deadlines and consistency protocol
(DEC-D-11/15/16) before any implementation relies on numerical defaults.

Read requests require explicit market/namespace and accepted scope; audit requires
its own grant and actor-field redaction. Guests receive no admin audit access.
Do not include secret settings, tokens, private documents, free-text payloads or
raw exceptions in events/projections. Consumer timeout remains pending/unknown;
rejection preserves the previous adopted version only where the accepted policy
allows it, otherwise sensitive operations fail closed. Forward rollback is a new
validated publication. No cross-domain transaction or exactly-once delivery claim.

Provider tests: version/hash/receipt compatibility; real scoped audit/immutable
history; publication/outbox atomicity and response loss. Consumer tests: actual
broker duplicate/hash conflict/order/gap/restart, lost adoption event and repair,
rejected revision, revocation, unknown major and unchanged historical snapshots.
Required packages: contracts, event-contracts, api-clients and technical messaging
exports; broker producer ACLs and scoped snapshot routes are E-owned. D creates
only its owner-local projection/migration after accepted contracts exist.

## REQ-W03-D-02 — Typed initial Reporting reads

Start with policy publication/adoption/audit visibility, without inventing real
operational counts or financial reports before their producers exist. Replace
CP-D-006's generic `rows: unknown[]` with accepted discriminated row schemas.

```ts
type ConfigurationReportQueryV1 = {
  marketId: UUID; namespace: string; from: UTC; to: UTC;
  cursor: string | null; limit: number;
  fieldset: 'POLICY_STATUS' | 'POLICY_AUDIT';
};
type ConfigurationReportPageV1 = {
  generation: UUID; asOf: UTC;
  quality: 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';
  nextCursor: string | null;
  rows: ConfigurationAdoptionV1[] | ConfigurationAuditRowV1[];
};
```

E must discriminate row type by fieldset, bound interval/page limits and cursor to
authorized query/scope/generation, and specify initial empty/watermark semantics.
Projection quality needs accepted freshness thresholds and source coverage; an
empty projection is not a zero business total. Public responses expose sanitized
coverage, not broker topology or private checkpoint keys. Missing/changed generation
and unknown major/fieldset produce accepted errors rather than mixed results.

These are reads with no mutation idempotency key. Reporting ingestion uses its
own namespaced inbox, payload hash and per-aggregate checkpoints. Rebuild/correction
has no notification, refund, booking or policy-publication side effect; failed
rebuild preserves the prior generation as visibly stale. Configuration is the
audit source, Reporting a derived read. No guest access, broad PII search or export
is implied; exports retain CP-D-006's separate Media/purpose/retention gates.

Provider/consumer tests: typed parser and redaction; real scoped HTTP including
cross-market/role rejection; replay/gap/correction/restart; generation change and
stale/unavailable rendering; no cross-currency aggregation if financial rows are
later accepted. E must name actual producer event/snapshot/replay/correction
contracts, package versions, auth grants and broker/source recovery windows.

## REQ-W03-D-03 — C reviewer and Booking providers

Required authority: C Workforce, Media and Booking; E publishes clients/routes.
Their concrete schemas must be in **BASE_W03** before D consumes them. Availability
is **not confirmed** at the current target; these remain explicit requests.

| Producer | Requested read/command contract and ownership | Required negative/recovery evidence |
| --- | --- | --- |
| Workforce | Typed dossier/list/detail with expected entity revision, current reviewer grant/market scope; review decision command with reason, expected revision, idempotency receipt and accepted transition/result enums | Revoked reviewer, cross-market/object access, stale/concurrent decision and changed fingerprint; eligibility is independent of Identity account status |
| Media | Classified clean private-object metadata and current reviewer-purpose authorization; short-lived read capability with exact object/revision/purpose binding and accepted expiry/revocation behavior | Quarantine, foreign object, wrong purpose, expired/revoked capability and access after a workforce decision; no public URL or embedded proof data |
| Booking | Bounded market-scoped list/filter/cursor/detail schema; booking/lifecycle revision and immutable vehicle/location/price/policy snapshots, authorized fieldsets and separate financial references/status | Foreign record, stale/generation cursor, missing provider/timeouts, privacy redaction and payment status differing from booking/work status |

C must supply required/nullable/unknown-field rules, IDs/revisions and schemas,
transition enums, service/actor authorization, exact durations/UTC/currency/exponent
semantics, deadlines/errors, replay lookup/fingerprint/lifetime and backward
compatibility. Read-only operations have no mutation key. Reviewer commands stay
within Workforce; file access stays within Media. D will not invent payloads,
copy private DTOs, decide C's outcomes, or inspect C's databases.

Provider acceptance precedes D browser consumption using real merged providers.
E must distinguish Workforce verification routes from customer Reviews moderation
in route IDs/clients. C's W01 packet is received but semantically unaccepted;
document receipt is not proof these runtimes are usable.
