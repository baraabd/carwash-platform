# W05-D — Electronic proof, cancellation, refunds and correction requests

Status: **UNACCEPTED PROPOSAL** submitted in W04-D for E/B/C owner review.
No endpoint, shared export, package version, policy or BASE_W05 is published by
this file. W04 consumes only its accepted base; the operations below are future
W05 scope and never W04 acceptance prerequisites. No real money/provider action
or cancellation/rescheduling is executed by this proposal.

## Release and authority requested

E publishes the reviewed HTTP/event/client schemas, exact package versions,
Identity/service/guest grants, Gateway routes/errors and actual common base.
Candidate wire major **1** below is a review label, not an accepted version.
Preserve existing strict booking.confirmed.v1 and Identity V1 compatibility.
Resolve B/C Money, method and revision differences through reviewed public
parsers/adapters, not a copied private DTO or silently widened existing event.

| Boundary | Requested authoritative owner / invariant |
| --- | --- |
| Payment proof review and payment verification | B Billing; accepting a proof for review is not received money; document contents never confer financial authority |
| Private proof upload/process/access | C Media with B's real payment/proof binding; current object/purpose/recipient authorization at every boundary |
| Cancellation / rescheduling intent and saga | C Booking; C Scheduling owns capacity replacement/release, Dispatch owns assignment release; accepted execution authority must define active-work eligibility |
| Refund request, verification and immutable reversal | B Billing; provider-verifiable status, posting links and financial approval; customer UI never declares refunded |
| Custody/settlement correction coordination | B Wallet references B Billing corrections; no rewritten posting/history or second ledger |
| Pending/failure/correction notifications | D Communications from actual owner facts and current recipient authority; no message changes Booking or financial state |
| Audit/freshness/reconciliation | Each owner writes its durable audit; D Reporting derives minimal views with source revisions/checkpoints |

Approved methods stay Cash/ShamCash/Syriatel Cash. Wallet is internal custody,
not a fourth checkout method. E/B must freeze public method mappings such as
reference `sham` versus B candidate `shamcash`. Paymera scope requires a separate
product/provider decision and actual documentation before any dependent connector;
this request does not add it or certify a provider.

## Common candidate schema vocabulary

Proposed closed objects; E/B/C must freeze parser rules/exports and nullability:

| Type | Candidate fields / semantics |
| --- | --- |
| ResourceRef | `{owner: owner discriminator, id: UUID, revision: OpaqueRevision}`; the owning service defines a validated revision token and current-read meaning |
| Money | Reference **B's reviewed public Money schema**, including canonical integer-minor string, currency and currency-policy revision; no float, assumed precision, D alias or default currency |
| PolicyRef | `{id: UUID, revision: OpaqueRevision}` for applicable published eligibility, financial, custody, media or communication policy |
| CommandEnvelope | `{operationId: UUID, idempotencyKey: bounded string, expectedRevision: OpaqueRevision, reasonCode: approved enum, policy: PolicyRef}` plus operation data below; actor/service identity and current scope are independently verified, never trusted from body |
| OperationReceipt | `{operationId: UUID, resource: ResourceRef, state: accepted/pending/unknown/rejected/failed, auditRef: UUID, acceptedAt: UTC instant or null, pendingPhase: approved enum or null, failure: approved safe code or null, nextAction: approved enum or null}`; consistency rules, not arbitrary combinations |
| FreshRead | `{resource: ResourceRef, evaluatedAt: UTC instant, sourceRefs: ResourceRef[], quality: current/stale/partial/unavailable, checkpointVector: source-specific validated entries, missingRefs: ResourceRef[]}`; current owner command reads remain distinct from delayed projections |

All properties listed by a finalized operation become required unless explicitly
nullable; absent/unknown fields, major versions and enum variants are rejected or
rendered unavailable, never silently coerced into success. Nullable proof/reversal/
posting fields must be null before the referenced fact exists, not invented IDs.
Exact enum members, field limits and revision rules remain release-blocking inputs.

## Candidate command/read families and exact payload requirements

| Candidate ID / owner | Data in addition to verified envelope | Response / authoritative validation |
| --- | --- | --- |
| W05-D-01 payment.proof-binding / B | Payment/obligation/Booking ResourceRefs, method, requested evidence purpose and expected payment revision | Real payment-scoped binding ID/revision, permitted upload requirements/expiry/recipient purpose; reviewer permission does not imply upload or money verification |
| W05-D-02 media.proof-reserve-finalize-access / C | B proof binding, expected binding/object revision, file metadata/checksum, purpose; access names selected object and approved review purpose | Reservation/object/scan revision, clean/quarantined/missing state; short-lived narrowly scoped access only after current B/C/E authority; no proof bytes or sensitive URL in events/logs |
| W05-D-03 billing.proof-review / B | Payment/proof binding refs, finalized Media refs/revisions, expected payment revision, decision=request-correction/reject/continue-verification, approved reason/requirements | Durable review receipt/revision/audit and pending/rejected/correction state. This command **cannot** alone mark paid; financial verification is separate |
| W05-D-04 billing.payment-verify / B | Payment/proof/provider transaction refs, expected payment revision, independently verified evidence/ref, exact Money/beneficiary assertions and approval policy | Authoritative verification receipt with provider provenance, method, amount/currency/beneficiary, immutable posting refs only upon approved matching; mismatch/unknown/duplicate outcomes explicit |
| W05-D-05 booking.cancel-intent / C | Booking ResourceRef, cancellation policy/reason, expected Booking revision, beneficiary relationship and requested scope | Durable operation/saga with per-owner capacity/assignment/finance compensation refs and pending phases; eligibility/current-work policy rechecked; intent is not final cancellation |
| W05-D-06 booking.reschedule-intent / C | Booking ResourceRef, accepted replacement quote/policy when needed, target Scheduling slot/hold refs/revisions, local display timezone and UTC appointment assertions | Durable replace/release orchestration and resulting appointment/Booking revision only after owner confirmation; losing capacity is explicit; historical snapshot remains immutable |
| W05-D-07 billing.refund-request / B | Verified payment/receipt refs/revisions, cancellation/compensation refs if relevant, exact requested Money, refund policy/reason, business refund ref and approval/evidence refs | Refund operation/ref/revision, eligible/remaining amount, pending/unknown/rejected state; partial refund reservations prevent competing over-refunds; no provider result is fabricated |
| W05-D-08 billing.refund-status / B read | Refund/payment ResourceRefs and accepted fieldset/purpose; current object/grant scope | Authorized requested/approved/submitted/provider-pending/partially-refunded/refunded/rejected/failed/unknown facts with posted/refunded Money and immutable original/reversal links; read does not resend |
| W05-D-09 billing.settlement-correction / B | Original settlement/receipt/posting refs/revisions, stable correction business ref, exact proposed difference Money, independent treasury evidence, reason/policy/approval refs | New immutable linked correction/reversal receipts/postings; original settlement preserved; discrepancy/pending status explicit; neither a handover declaration nor a proof image grants correction |
| W05-D-10 wallet.custody-correction / B | Handover/custody refs/revisions, verified Billing correction refs, affected holder/recipient/purpose and policy | Derived custody reconciliation revision and outstanding discrepancy refs after current Billing read; no mutation of Billing journals |
| W05-D-11 owner.operation-read / C/B | Exact operation ID and resource, current actor/beneficiary/grant scope | Durable receipt, phase, authoritative owner refs/revisions, retry/compensation/deadline status; response-loss recovery without a second business operation |
| W05-D-12 communication.operation-read / D | Notification/conversation/message ID, owner source operation ref, current participant scope | Safe intent/attempt/provider outcome/browser receipt/read fields; partial/failed/unknown states distinct; denied former membership leaks no message or proof metadata |

Actor/guest: authenticated admin acts under a distinct create/review/finance/approve
grant and market/resource scope; beneficiary is server-validated A/C owner data.
Guest capabilities must be E's accepted resource/purpose-limited contract, never
an arbitrary bearer UUID. Sensitive commands evaluate current authorization and
expected revisions at commit; revoked grants cannot rely on a stale page.
Any maker/checker separation, eligible treasury role, custody holder or approval
threshold must be explicitly approved; this packet sets no policy defaults.

## Proposed events and delivery semantics

Every new closed event uses E's accepted envelope with immutable event ID, exact
event type/major, producer identity, occurredAt UTC, correlation/causation and
owner aggregate ID/revision. Propose the following data/discriminators for review:

| Candidate event family / producer | Required data / safely nullable fields |
| --- | --- |
| proof-review-outcome / B | Payment/proof/review ResourceRefs, decision, safe reason/requirement codes, policy ref, reviewedAt; financial verification ref null until independently verified |
| payment-verification-outcome / B | Payment/obligation/Booking refs, verification ref, method, outcome, Money only if required by approved recipients, policy/time; postingRefs empty before posting, never interpreted as received money |
| cancellation-or-reschedule-progress / C | Booking/operation refs, explicit operationKind=cancel/reschedule, phase and current appointment/capacity/assignment refs, policy/time; resulting refs null while unknown/pending; amount belongs to separately sourced B facts |
| refund-progress / B | Refund/payment/operation refs, outcome and authoritative requested/accepted/refunded Money, original/reversal posting refs, policy/time; provider outcome/evidence ref null while unverified |
| settlement-correction-progress / B | Original/correction settlement and posting refs, outcome, source revisions, discrepancy Money/policy/time; original history never overwritten |
| participant-access-change / C with E authority | Exact Booking/assignment/membership generation, affected opaque participant refs, effectiveAt/revision, revoked purpose; no contact/document/location payload |
| notification-outcome / D | Notification/source-operation refs, recipient opaque ref, approved template/purpose/channel, intent/attempt/outcome revisions, server/provider evidence times; providerReceiptRef/deliveredAt/readAt each null until separately verified |

B/C/E close event names, enum sets and schema exports before BASE_W05. A local
fixture is labeled and never substitutes for actual producer/consumer evidence.
Do not widen strict existing v1 data to carry these fields.

D requires an approved event → template → purpose → eligible current recipient →
channel matrix for each pending/correction/rejection/failure outcome. Private
proof contents/URLs and financial internal account identifiers are excluded from
events and user notifications. Before read/send/fanout, current owner membership
and Identity scope fence removed participants; delayed revocation events alone
cannot authorize access. W05 cancellation must specify this revocation integration;
W04 tests use its current reassignment/revocation, not W05 commands.

Provider acceptance, independently verified delivery, browser receipt and user
read remain separate. Provider callback authentication, transaction matching,
signature/replay window, service credentials, adapter idempotency/query capability
and declared actual channel must be documented/tested before acceptance. OTP
webhook email does not certify Communications email or SMS. Unknown provider
outcome is reconciled before resend; lack of safe query/idempotency is an explicit
blocked/manual-review state, not blind retries or simulated successful delivery.

## Revision, time, recovery, compensation and compatibility

Expected revisions are owner-specific; multi-owner prerequisites carry separate
refs, never one invented global version. UTC wire instants have an explicit zone;
local appointment rendering uses the accepted market timezone/configuration.
E/B/C must freeze exact deadline/expiry/retry/replay/retention/cursor lifetimes,
business timezone, reason eligibility and financial precision from real inputs.
No default seconds, currency scale, fee or refund amount is invented here.

Idempotency scope includes verified actor/service, owner, operation/resource and
stable business identity. Persist canonical fingerprint and replayable receipts
with local state/outbox. Same key/bytes recover the same outcome; changed bytes
conflict. Permanent business uniqueness survives retry-key retention. Unknown
outcome uses operation lookup/reconciliation, never a new key to force another
refund/reschedule/correction. Read APIs have no mutation idempotency key.

Freeze safe versioned errors for denied/revoked/object mismatch, stale revision,
ineligible transition, unavailable/expired replacement capacity, proof quarantine,
currency/amount mismatch, duplicate business ref, refund over-reservation,
provider timeout/unknown, and partial compensation. Distinguish retryable failures
from definitive rejection; durable dueAt/attempt budget/lease fencing and observed
terminal parking require owner audit and authorized replay.

Booking owns durable cancel/reschedule coordination; Scheduling owns hold/slot
replacement/release, Dispatch owns assignment release, and B owns financial
refund/reversal/custody correction. D only consumes progress and sends approved
notifications. Every compensation has a distinct stable identity, recorded owner
outcome and pending/manual-reconciliation path. No cross-owner table update,
fictional rollback of completed work or late-payment capacity resurrection.

Publish a supported-major/reader compatibility matrix, exact parser/client exports,
old/new schema migration and consumer rollout/deprecation evidence. Unknown enum
or major cannot mean success. Additive changes require old-reader proof; breaking
changes require explicit review and a new common base before dependent work.
Schema/migration expand-contract must preserve historical immutable receipts.

## Provider/consumer gates requested before W05 acceptance

Accept narrow real B/C/Media binding providers and current Identity authorization
before D proof/admin/refund/cancellation consumers; split any cycle into binding,
provider, then consumer children. Test own DB upgrade/constraints, durable command
receipts, current object authorization and frozen schema conformance first.
Then run real matched/mismatched proof review, concurrent partial refund limits,
cancel/reschedule races with capacity replacement/release and distributed partial
failure, immutable linked settlement corrections, private-access expiry/revocation,
provider timeout/replay/crash, participant removal and independent notification
outcomes on serialized integrated source. Approved visible partial/pending/failure
states and Linux plus separate Windows/device evidence remain mandatory.

These W05 gates are **NOT_RUN / future scope**, not additional W04 cash gates.
Dependencies/package/configuration requests go only to E: reviewed shared schemas,
clients/events, service identity, Gateway routes, actual provider adapter/version,
broker topology/ACL, isolated resources, pinned tooling and required CI commands.
No peer source, manifest, shared package or infrastructure is edited by this file.
