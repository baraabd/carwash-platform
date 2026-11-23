# W07-B — Promotion allocation and Pricing governance proposal

Status: **PROPOSED_NOT_ACCEPTED / IMPLEMENTATION_ABSENT / TESTS_NOT_RUN**.
Proposal revision `w07-b-pricing-governance/0.1.0`. Source observation:
`f01e87f4619414960e9e39c65e523a3250fbcbaf`, tree
`2266f157ad2480855011d5da59e00e5b0cf1f68f`. This is the observed target,
not a published `BASE_W07`. The merged W06 packets are proposals; Pricing still
has only `ServiceMarker` persistence and empty application/ports. There is no
live quote, promotion, price governance API or accepted business V1 export.

This document develops CR-B07-01/02/03 in the
[merged W06 requests](../W06/W07_CONTRACT_REQUESTS.md). It proposes provider
semantics and future acceptance; it grants no product writes, policy approval,
shared schema changes, merge or live financial execution. Required promotion
and real Pricing administration scope remains a full-launch blocker, not an
optional feature. The W07 parent remains `NOT_STARTED` in this fallback phase.

## Authority and unresolved decisions

F001 assigns immutable price versions, quotes and promotions to **Pricing**.
Catalog supplies definitions, descriptions, durations and compatibility through
its public revisions. Catalog never publishes monetary discount authority.
D's [D07-05](../../D/W06/W07_CONTRACT_REQUESTS.md) label `B Pricing/Catalog`
must resolve to these distinct owners. D Configuration publishes approved policy
inputs; D admin invokes Pricing commands; neither maintains shadow pricing data.
C Booking owns the distributed saga, capacity and cancellation decision. Billing
owns monetary postings/refunds; Subscription owns benefits. A supplies its owned
customer/vehicle/Geo facts. Reporting cannot authorize a current redemption.

| Full-launch blocker | Accountable decision/provider owner | Required approval or evidence |
| --- | --- | --- |
| PB-01 Base and schemas | E with B/A/C/D review | Actual `BASE_W07`, supported contract majors, closed schemas/parsers/clients, route/service grants, resource allocation and exact child gates. Current contracts/event-contracts `0.0.2` and api-clients `0.0.1` contain no Pricing business exports. |
| PB-02 Rates and calculation | Business/accounting owner, B, D Configuration | W01 B-03/04: real prices, supported currency/exponent, amount bounds, fee/tax bases, rounding at each stage and immutable applicability revisions. Missing inputs fail closed; no implied zero charge/tax. |
| PB-03 Quote validity | Business owner with B/C | W01 B-05: expiry/skew, bind/admission trigger, publication/retirement honoring, exceptional revocation, replay/tombstone lifetimes and exact rules for already admitted quotes/bookings. |
| PB-04 Promotion economics | Business/product/accounting owner | W01 B-10: eligibility, type, item/scope, use units, windows, stacking precedence, eligible discount base, budget/global/customer/guest caps, reserving/committing trigger and release/restoration rules. No guessed promotion or percentage. |
| PB-05 Guest beneficiary | E Identity with A/B/C and privacy owner | W01 B-15: verified guest capability, expiry/revocation/recovery/claim and approved stable limit identity. A device cookie, IP address, plate or contact hash is not an approved customer identity. |
| PB-06 Governance authority | Business owner, E Identity, B/D | Author/reviewer/publisher/retirement/schedule actions and object/market scope, required separation/approval limits, whether review may be reused after any change, schedule overlap/cancellation rules. |
| PB-07 Mixed benefit and restoration | Business/accounting owner with B/C | W01 B-06/09/10: benefit/promotion order and exclusion, refund/consumed-use treatment, cancel trigger, each independent restoration allowance and terminal evidence. Refund acknowledgement does not restore use capacity. |
| PB-08 Real dependencies | E with A/C/D and B providers | Real Catalog, policy, current Identity/guest, Booking intent/fence, Subscription/Billing providers and subsequent three-app consumers. No fixture-backed integration acceptance. |

No maximum, TTL, retention period, merchant capability or separation policy is
approved by this proposal. A clearly identified isolated test policy may exercise
a rule; it cannot enable the rule for launch. Wallet is an internal owner, not a
fourth checkout rail; cash, ShamCash and Syriatel Cash UI methods remain frozen.
Required Paymera scope/evidence stays open under W01 B-02/11.

## Proposed closed transport profile

Each family below requests a reviewed first business `v1` only if none has been
accepted at publication; otherwise E selects a compatible additive release or a
new major/explicit adapter. These names and types are **candidate semantics**.
No unknown-field tolerance or existing strict validator is changed here.

| Dimension | Proposed rule for publication |
| --- | --- |
| References | Opaque owner-scoped IDs and immutable opaque revision tokens; `expectedRevision` means the exact current revision, not an ordering or a global sequence. Resource, operation, business-effect and event identities remain distinct. E must reconcile D's integer revision proposal without lossy coercion. |
| Money | `{ amountMinor: string, currency: string, minorUnitExponent: integer, currencyPolicyRevision: Revision }` with canonical nonnegative integer strings and approved bounds. Signed posting direction is separate. Use exact integers internally. Discount ratio uses an approved bounded integer numerator/denominator profile, if selected; no binary floats or assumed basis points. D's decimal/minor-unit alternatives require one accepted profile. |
| Time | Canonical UTC instants; explicit approved market timezone for local schedules. Candidate windows are `[startsAt, endsAt)` with `startsAt < endsAt`; acceptance must settle boundary, clock authority/skew, issue/bind/commit eligibility and scheduled activation. Never infer production timezone from illustrative copy. |
| Current actor | Derive actor/session/authVersion from current Identity verification; bind subject/guest, delegation, audience, action/object/market/purpose. Service calls have authenticated scoped identities. Caller-supplied actor/beneficiary is not authority. Check current authorization again on protected read, command, replay and history. |
| Command metadata | Closed command family/major, ingress key, stable businessOperationId, expected revisions and reasonCode as applicable. Uniqueness scopes the verified actor/service, owner, operation family/major and key; the canonical fingerprint binds the beneficiary/target/business meaning, rather than creating a second effect when a key's target changes. E reconciles D commandId/pending conventions explicitly. |
| Fingerprint | Contract major, target/beneficiary/delegation, normalized selections and coupon input, quote/promotion/policy/benefit/Booking refs and revisions, exact Money/units, expected revision, effective time and permitted reason/evidence refs. Set-valued IDs sort after duplicate rejection; ordered stacking stages retain order. Exclude secrets, transport IDs and incidental timestamps. |
| Receipt/status | Stable operationId, resourceId, resulting owner revision, acceptedAt, completedAt nullable, closed phase/outcome, safe reason and typed causal refs. `completedAt` is null while outcome is unresolved. Owner lookup remains authoritative; Reporting asOf/coverage is advisory. Freeze action-specific required/null fields before publication. |
| Replay | Same key/meaning recovers original receipt, IDs and expiry after current authorization; changed meaning conflicts. Concurrent pending recovers one operation. Permanent business-effect uniqueness survives receipt-cache cleanup. E/business owners publish exact replay, tombstone, reservation and history lifetimes. |
| Failure | Candidate reasons: `INVALID_INPUT`, `AUTHORITY_UNAVAILABLE`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `POLICY_UNAVAILABLE`, `INELIGIBLE`, `LIMIT_EXHAUSTED`, `QUOTE_EXPIRED`, `QUOTE_REVOKED`, `CURRENCY_MISMATCH`, `REVIEW_STALE`, `EFFECTIVE_INTERVAL_CONFLICT`, `DEPENDENCY_UNAVAILABLE`, `OUTCOME_UNKNOWN`. E freezes safe HTTP/error mapping and non-enumerating foreign-object policy; do not emit arbitrary upstream prose. |
| Transport recovery | Bounded owner deadlines; timeout is `OUTCOME_UNKNOWN` with the original operation lookup/retry owner. No new-key repeat or inferred noncommit. Persist business state, receipt, audit and outbox in one local transaction. Consumers commit inbox/hash/effect/checkpoint before ACK; conflicts quarantine, gaps repair via authorized bounded owner history. |

## Immutable quotes and promotion semantics

Candidate `pricing.quote-issue.v1` receives normalized selected Catalog IDs and
quantities, authorized subject context, current authoritative vehicle/zone and
availability input refs, coupon input if provided, requested benefit refs if
policy permits, and command metadata. It receives **no client rate, tax,
discount, authoritative owner or total**. Pricing reads accepted current Catalog,
policy and relevant owner eligibility. Quantity bounds and bulk applicability
require the frozen single-vehicle journey decision; this proposes no bulk UI.

The immutable result includes quoteId/revision, beneficiary and protected actor
provenance, original issuedAt/expiresAt, Catalog/description/price/policy/zone
revisions, each line's identity/quantity/unit amount, eligibility inputs, ordered
discount/benefit/fee/tax calculation evidence, exact aggregate Money and typed
promotion/benefit evaluation refs. Equations and rounding are validated server
side. No projection, future price edit or replay changes this snapshot.

Quote issuance and an eligibility preview **do not reserve a coupon**. A preview
may become stale; commit checks durable owner capacity under the accepted policy.
The quote states which limited offers need reservation, avoiding a promise that
preview equals redeemed. If reservation fails, the original quote is not silently
repriced: C/A recover/refetch and obtain any required explicit user acceptance of
a new quote. Existing seven screens, guest cash and optional plate remain intact.

Promotion publication binds an approved immutable policy/version/content hash:
eligible definition revisions/categories/market/subject class, include/exclude
and minimum-qualifying-value rules if approved, time window, exact discount
representation and cap, stacking groups/precedence, budget currency, counted use
unit and global/per-beneficiary limits. A limit is bounded or explicitly unbounded
only where the accepted schema/policy permits it; omission is not unlimited.
Counters identify the immutable promotion rule and approved counter epoch, not
an admin label that can be renamed to reset usage. Superseding a promotion must
not reset historical counters unless an explicit approved new economic allocation
defines the relationship. Retired versions remain auditable.

Stacking is deterministic under the approved policy. Validate eligibility on the
correct price basis, apply each ordered stage once, cap discount at eligible
value, and show each causal adjustment in the quote. Subscription-covered units,
included add-ons and discounted chargeable items require an explicit allocation
rule; neither A nor C independently calculates a second discount. Currency,
overflow, invalid ratios or unavailable policy reject without quota mutation.
No arbitrary admin override or client promo discount is introduced.

Per-account limits use the authorized beneficiary. Guest limits require the
approved stable server identity and recovery/claim rules. A new guest capability
must not reset a cap merely because its token changes. No hidden device
fingerprint, forced account, required plate or retained raw contact is introduced
as an anti-abuse policy. Customer/Identity own claim mapping; Pricing owns only
the approved scoped beneficiary token, limit records and its classified audit.
Identity changes/claims need a published collision-safe quota-transfer rule and
current authority; never add two allowances by merging records. Financial and
promotion metadata require B-12 export/retention classification, including
quotes, counters, receipts, queue copies and redaction-safe history.

## Durable reservation, commitment and restoration

Proposed command/read families, all closed and owner-authorized:

| Candidate family | Required meaning and result |
| --- | --- |
| `pricing.promotion-evaluate.v1` | Quote/beneficiary/promotion/policy refs and current input revisions; informational eligibility and safe ineligible reasons/asOf. Never grants a use. |
| `pricing.promotion-reserve.v1` | Immutable quote plus promotion/policy and accepted Booking intent/fence, beneficiary and stable redemption business identity. Independently validate quoted discount/economic meaning and capacity; return reservationId/revision, exact reserved uses/budget and original expiry. |
| `pricing.promotion-claim.v1` | Reservation revision and durable C fulfillment business attempt/authority fence; atomically bind one irreversible-attempt identity before that attempt can commit remotely. Return original claim/fence or conflict. Not permission for C to mutate Pricing data. |
| `pricing.promotion-commit.v1` | Claimed reservation/attempt/fence and authoritative approved commit-trigger evidence, with causal Booking/benefit/financial refs as applicable. Exactly one redemption receipt; monetary posting refs are required only if this accepted trigger actually has a Billing effect, never fabricated for cash/free eligibility. |
| `pricing.promotion-release.v1` | Reservation/claim revision, reason and authoritative terminal noncommit fence when claimed. Release only an eligible uncommitted exposure; persist original release receipt. Expiry on an unclaimed reservation is a fenced local transition, not a blind delete. |
| `pricing.promotion-restore.v1` | Committed redemption and approved independent correction/restoration decision, its policy/revision/allowance and exact original-effect linkage. Append a restoration receipt; no deletion/rewrite of redeemed history or reuse of a generic cancel event as proof. |
| `pricing.operation-read.v1` / `pricing.promotion-history.v1` | Current scoped operation/reservation/redemption/restoration status or bounded authorized owner history with revision/cursor/coverage. Customer/operator fieldsets exclude private admin/audience data. |

Proposed reservation states are `RESERVED → CLAIMED → COMMITTED`, with
`RESERVED → RELEASED` or `EXPIRED` and `CLAIMED → RELEASED` only on accepted
terminal noncommit authority. `UNKNOWN` is an unresolved operation phase, not a
free-capacity terminal state. The exact schema enumerations/nullable evidence
must be accepted; these are not additions to an existing closed V1.

In one Pricing DB transaction, lock/check the applicable promotion global,
budget and beneficiary counter rows in stable order, enforce approved bounds,
insert the unique redemption business identity, reserve exposure, and write
receipt/audit/outbox. An equivalent proven transactional constraint is acceptable.
Reserved/claimed exposure plus committed counted use must never exceed its
approved limit. Budget arithmetic is exact and currency-specific; commit moves
existing held exposure to used exposure without a second decrement. Release
removes only that operation's held exposure once. Under contention a final use
or final budget unit has one successful reservation. Retry a serialization
failure within accepted bounds using the same operation identity.

Required local constraints include uniqueness for owner operation receipts and
stable redemption business effects, valid transition/fence revisions, nonnegative
counter partitions and policy-bound upper limits. The approved counting unit
determines whether the unique business identity uses a Booking line/use token;
do not assume one coupon equals one whole Booking without B-10 approval. Cross-key
duplicates resolve the original effect and cannot reserve additional headroom.
Runtime permission and migration/upgrade tests must prove the effective database
constraints, not only application checks.

Before C submits an operation that can create the policy's irreversible trigger,
C and Pricing must persist the bound attempt/claim under the accepted protocol.
If the remote outcome becomes pending/UNKNOWN, the claim remains unavailable
after local reservation expiry, worker lease expiry, timeout or session
revocation. An old worker cannot commit after a terminal noncommit fence used
for release. A delayed successful result matches the original attempt and
commits its original receipt once. No arbitrary timer treats missing response
as failed commitment. If the selected trigger lacks a queryable/fenced terminal
provider protocol, this recovery path is **blocked**, not optimistically released.

Cancellation, confirmed money return, benefit correction and coupon/budget
restoration are independent operations with separate owners and decision refs.
COMMITTED cannot transition to RELEASED. An approved restore appends a linked
correction with permanent original-effect/decision uniqueness and capped
restoration; conflicting or repeated requests do not restore twice. A stale cancel,
pending refund, downstream replay/rebuild or administrative version publication
cannot replenish global/customer/guest capacity. Whether a restoration makes any
future promotion use eligible, and under which version/window, is B-10 policy.

Mixed benefit/promotion use comprises separate Pricing and Subscription DB
transactions. C persists their child operation IDs and progress. If the second
reserve fails, C requests eligible release of the first; both owners expose actual
state while compensation is pending. Final-unit benefit and final-coupon races
each have one winner locally; no cross-DB atomicity is asserted. Partial commit
or UNKNOWN keeps the corresponding resources fenced and drives accepted
recovery/linked remedy. It never exposes a spent benefit or commits a changed
quote silently. Billing's obligation/allocation remains independent evidence.

## Real Pricing administration provider

Proposed closed families: `pricing.version-create.v1`,
`pricing.version-amend-draft.v1`, `pricing.version-submit.v1`,
`pricing.version-review.v1`, `pricing.version-publish.v1`,
`pricing.version-retire.v1`, `pricing.schedule-cancel.v1`, plus bounded authorized
version/operation/audit history reads. Promotion governance may share transport
metadata but has its own policy/applicability checks and counter continuity.

| Candidate lifecycle | Required current owner guard and immutable evidence |
| --- | --- |
| Create/amend draft | Current scoped author; expected draft revision; validate accepted Catalog/rate/policy shapes. Persist new draft revision/content hash. No economic effect or mutable published rate. |
| Submit/review | Current designated action grants; bind exact draft revision/content hash, policy/applicability and proposed effective interval. Approve/reject has reason and immutable reviewer audit. Review separation/limits are PB-06 decisions. |
| Publish | Current scoped publisher; compare expected active/publication revision and reviewed exact content/revision, not only a boolean reviewed flag. Changed content/policy/effective interval invalidates review under the accepted rule. Append publication plus operation/audit/outbox and atomically change the owner pointer/schedule. |
| Effective activation | Approved nonoverlapping applicability intervals or explicit accepted priority model. A durable fenced worker recovers scheduled activation; reads resolve authoritative effective version using server time. Restart or stale worker cannot activate an invalidated/cancelled schedule. |
| Retire/supersede | Current scoped action and expected revision; append retirement/successor history with effective UTC and reason. New quotes exclude the retired version at the accepted boundary. Historical quote/receipt content never changes. |
| Cancel schedule/history | Separate expected revision/action; one winner against activation. Read historic definitions/rates under current fieldset grants; cancellation does not delete already effective history or reverse prior money. |

Proposed authorization action names are `pricing.version.create`,
`pricing.version.review`, `pricing.version.publish`, `pricing.version.retire`,
`pricing.schedule.cancel`, `pricing.promotion.manage` and scoped reads; E must
publish their actual accepted action/object/market mappings. Existing
`billing.refund`, generic staff/admin identity or UI access grants none of them.
Owner HTTP enforces current authVersion/revocation and approved delegation even
if Gateway previously allowed the request. D sends owner commands and renders
owner receipts/current status; it cannot change counters or publish via Reporting.

The real migration must establish immutable reviewed/publication revisions,
effective interval/applicability consistency, operation/business uniqueness,
concurrent active-pointer CAS and append-only audit/outbox behavior. SQL/runtime
role checks must still hold after E's actual role reprovisioning, which currently
regrants broad runtime UPDATE/DELETE. B supplies owner table/role constraints;
E supplies a compatible provisioning plan. Do not claim an application-level
"immutable" flag prevents direct runtime mutation.

Two commands with the same expected active revision cannot both publish. Publish
versus amend/review/retire/schedule-cancel races must compare their exact source
revisions in the owner transaction. Overlapping effective versions cannot produce
an arrival-order or arbitrary winner. Proposed rejection of conflicting intervals
requires PB-06 acceptance, or a reviewed explicit priority model replaces it.

At publication/retirement boundaries, new quotes resolve the accepted currently
effective version. Existing issued/admitted/bound quotes and confirmed Booking
snapshots follow PB-03 honoring/revocation rules; neither D nor a new price worker
rewrites them. Revocation, if approved, is an explicit auditable separate fact,
not deletion of history. Rebooking always requests a new quote with current
authorized inputs and explicit customer review of any changed price.

## Provider and consumer child gates for E agreement

These names are a queued dependency proposal, **not E-agreed children or active
implementation branches**. Parent becomes `INTEGRATION_PENDING` after real
implementation starts and cannot close before the complete combined matrix.

| Proposed child / order | Writer and scope | Gate before dependent consumer merge |
| --- | --- | --- |
| W07-P0-Contract-and-policy-release | E and actual policy owners, owner review | Resolve PB-01..08, exact accepted package/schema/route/grant/resource release and immutable common base; no fixtures as commercial decisions. |
| W07-C0-Booking-intent-fence-provider | C; narrow intent/binding/current cancellation fence only | Real C DB/HTTP/current Identity, immutable attempt status and no-late-commit fence conformance against published profile. No coupled final promotion saga required to accept this narrow provider. |
| W07-B1-Pricing-governance-provider | B Catalog prerequisite then Pricing | Real current Catalog/policy providers, owned migrations/upgrades/runtime constraints/current Identity HTTP, publication concurrency and immutable quote history; real event/receipt recovery. |
| W07-B2-Promotion-allocation-provider | B Pricing; B1 + merged C0 and actual needed Subscription/Billing prerequisites | Real final-use/budget/beneficiary SQL races, claim/UNKNOWN/expiry/restoration constraints, accepted conformance and crash/replay recovery. Provider tests use the real merged narrow C fence; a fixture cannot close that gate. |
| W07-C1-Rebooking-and-mixed-finance-consumer | C Booking against merged B1/B2 and required B Wallet/Subscription/Billing | Real capacity/price/benefit/promotion orchestration, partial compensation and terminal fence recovery; no unmerged peer branch as base. Full affected real journey before this consumer merges. |
| W07-A1-D1-Pricing-app-consumers | A customer, D admin/reporting against merged providers/C1 | Actual seven-step quote/promotion/rebook and D create/review/publish/retire/history actions, current grants, independent sessions, receipt/error recovery and required parity/accessibility evidence. |
| W07-I-Three-app-finance-candidate | E serialized combined source; A/B/C/D | Full required cash/electronic/Wallet/Subscription/refund/promotion/rebook/admin reconciliation matrix, exact source/tree/contracts and real external evidence. Missing prerequisite is full-launch NO-GO. |

B service-local migrations are append-only when implementation is authorized.
Shared packages, contracts/clients, manifests/lockfiles, Gateway origins/routes,
Identity permission registry, broker ACLs/topology, provisioning, global CI and
resource allocation remain E requests. Proposed events retain the exact existing
V1 envelope and request closed minimal data: owner resource/revision, operation,
policy/effective time and causal quote/reservation/redemption/restoration refs.
Financial adjustment Money appears only in accepted authorized contribution
events; no coupon secret, contact, plate, evidence image or complete private quote
is broadcast. Candidate names include `pricing.price-published.v1`,
`pricing.price-retired.v1`, `pricing.quote-issued.v1`,
`pricing.promotion-reserved.v1`, `pricing.promotion-committed.v1`,
`pricing.promotion-released.v1` and `pricing.promotion-restored.v1`.
They are registry requests, not published events or a new ledger.

Any required additive request goes through E for the next accepted common base
before dependent consumers use it. A closed shape that cannot admit the addition
requires a reviewed version/adapter and new base; never widen an old parser
silently. No shared DTO/export/private Prisma import is created by this packet.

## Required acceptance scenarios — all NOT_RUN

These are future real acceptance specifications, not executable evidence. Tests
need E-allocated isolated resources; no business database, broker, provider or
browser environment was used for this document. Synthetic fixtures, if later
used for focused checks, remain separately labeled and cannot close these rows.

| ID | Required real scenario and success evidence | Gate owners | Status |
| --- | --- | --- | --- |
| W07-P01 | Simultaneous last global use and exact remaining budget: one reservation winner, correct held/used partitions, loser no side effect; include serializable retry and restart. | B SQL/HTTP | NOT_RUN |
| W07-P02 | Final customer and approved guest limit; separate and recovered/revoked guest tokens plus accepted account claim collision. No cap reset, foreign leak or forced plate/account. | E/A/B real Identity + SQL | NOT_RUN |
| W07-P03 | Window just before/at start and end, timezone transition/skew, eligibility change between quote/reserve/claim/commit, retired promotion; exact accepted policy and original quote evidence. | B/C provider | NOT_RUN |
| W07-P04 | Ordered overlapping promotions, included add-ons, entitled units, fees/tax/rounding, cross-currency/overflow/invalid ratio and missing policy. Quote equations prove no duplicated discount or capacity effect. | B Pricing/Subscription | NOT_RUN |
| W07-P05 | Last benefit versus last coupon reservations across two real owner DBs; second-step refusal and crash preserve pending release/compensation. No asserted cross-DB atomicity. | B/C integration | NOT_RUN |
| W07-P06 | Same-key response loss, same-key changed-payload conflict, cross-key business duplicate, duplicate coupon selection and cache/tombstone cleanup. One enduring original redemption/effect. | B SQL/HTTP | NOT_RUN |
| W07-P07 | Claim before irreversible trigger; commit reply loss, worker crash/restart, hold/lease expiry/revoked session while remote UNKNOWN. Exposure remains unavailable; same operation reconciles once. | B/C actual providers | NOT_RUN |
| W07-P08 | Commit versus expiry/cancel/release, terminal negative fence versus delayed worker, event reorder/hash conflict/gap/rebuild. Exactly one authoritative terminal result and no late commit after capacity release. | B/C DB + broker | NOT_RUN |
| W07-P09 | Confirmed/pending/failed refund and independent benefit/coupon restoration under approved policy; duplicate/conflicting restoration decisions and over-restoration reject, original consumed history retained. | B/C/D real refund/correction | NOT_RUN |
| W07-P10 | Draft change versus review/publish; two same-revision publishers; overlapping applicability/effective intervals and different key retries. One publication winner, exact reviewed content and audit survive restart. | B SQL/HTTP | NOT_RUN |
| W07-P11 | Forbidden role, revoked session/current authVersion, forged actor/delegation, foreign market/object and direct owner request; positive approved actions with actual D independent session. | E/B/D current Identity | NOT_RUN |
| W07-P12 | Scheduled activation just before/at boundary, clock policy, worker restart/stale lease and cancel/retire race. Immutable effective history and deterministic eligible new quotes. | B SQL/worker | NOT_RUN |
| W07-P13 | Real new quote after price change/retirement and rebooking, admitted old quote/Booking/receipt under honoring policy, explicit revoked quote if approved. Prior snapshots never mutate. | B/C/A/D real journeys | NOT_RUN |
| W07-P14 | Fresh install and upgrade with schema/migration parity, constraints/concurrent counters, runtime direct mutation and E reprovisioning; owner isolation/rollback compatibility preserve history. | B migrations + E roles | NOT_RUN |
| W07-P15 | Authorized quote/promotion export, beneficiary redaction/retained exceptions and projection/replay history after privacy action; foreign/revoked access denied. No posted money/history deletion or invented retention period. | B + approved privacy owners | NOT_RUN |
| W07-P16 | Producer outbox crash before/after confirm and consumer crash before ACK, repeated/hash-conflicting/stale/gapped events and actual owner history repair. No second redemption/restoration/refund or leaked coupon/contact. | B/D/C real broker | NOT_RUN |
| W07-P17 | Full customer/operator/admin finance matrix on E latest candidate, real D governance affects only eligible new quotes, recovery errors approved in Arabic/RTL and separate accepted English states. Each required electronic route has genuine accepted evidence. | E/A/B/C/D serialized gate | NOT_RUN |

Local document/reference checks prove only bounded proposal integrity. None of
the above acceptance rows is passed by foundation CI, schema validation, a
historical helper unit test, a merged request packet or a provider fixture.
