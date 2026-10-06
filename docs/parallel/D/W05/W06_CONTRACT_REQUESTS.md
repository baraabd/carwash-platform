# W06-D — Support, Reviews, communications and financial administration

Status: **UNACCEPTED NEXT-WAVE PROPOSAL** for E and affected A/B/C/D owners.
Submitted by W05-D; no W06 operation is implemented or made a W05 acceptance
prerequisite. No accepted contract, package/wire release, common base, permission,
policy or provider capability is created by this document.

## Ownership and bounded product scope

| Boundary | Provider / consumer authority |
| --- | --- |
| Support case, evidence binding, resolution and refund linkage | D Support owns case/resolution; A customer and C Booking/Media supply current ownership/evidence; B alone decides/executes refunds |
| Verified review eligibility and moderation | D Reviews owns reviews/moderation; C supplies real completed-work/Booking eligibility refs; A supplies current customer identity/consent; product decides exact rule without conflating completion and payment |
| Templates, recipient consent, conversations and status delivery | D Communications with A consent, C participant/assignment/Booking and E current identity authority; D never invents membership from an arbitrary room/ID |
| Wallet/custody administration | B Wallet with Billing posting/settlement links; no second ledger, customer funding/withdrawal, fourth payment method or payroll expansion |
| Subscription administration / entitlements | B Subscription with Billing monetary policy and C Booking reservation/use/compensation; no automatic recurring debit or new provider plan |
| Contract/client/Gateway/policy publication | E with provider/consumer review; proposed types do not authorize D edits to shared packages, manifests or infrastructure |

The approved inventory bounds W06 actors and purposes. E/B/C must close holder,
hold purpose, subscriber entitlement, freeze/release/consume/correction and
notification policy. Admin is a consumer, not a business database or override.
Support can request a money remedy and record its B link; it cannot set paid,
refunded, settled or a Wallet balance. Reviews eligibility must be owner-verifiable,
not inferred from a badge, screenshot, cash receipt or payment navigation.

## Candidate closed schema vocabulary and version request

Candidate wire major **1** is a review label; exact E package versions and public
parsers/clients remain unpublished. Preserve strict existing Identity/Booking V1.
Use E's reviewed ID and owner revision types and B's reviewed Money; settle prior
amountMinor/minorUnits/exponent/policy vocabulary differences with explicit
compatible parsers/adapters, never an unreviewed D DTO.

| Candidate type | Required fields / nullability semantics |
| --- | --- |
| ResourceRef | `{owner: closed owner discriminator, id: validated stable ID, revision: validated owner revision}`; owner selects scalar/parser, no invented global revision |
| ActorScope | Verified subject/session/auth revision, initiating service/delegation when applicable, action/object/market/purpose and beneficiary binding; transport identity is independently verified, not trusted body data |
| Mutation | `{operationId, idempotencyKey, target: ResourceRef, expectedRevision, policyRef, reasonCode, data}`; exact bounds/enum/required fields frozen per command |
| OperationStatus | `{operationId, resourceRef, revision, outcome, pendingPhase, acceptedAt, completedAt, auditRef, ownerResults, safeFailure, nextAction}`; unfinished timestamps/result refs explicitly null; states consistent with current owner facts |
| FinancialLink | `{requestRef, billingOperationRef, paymentReceiptRefs, refundRef, postingRefs, authoritativeMoney, evaluatedAt}`; refund/posting refs null/empty until B's real fact exists; no absent link interpreted as zero/refunded |
| ReadFreshness | `{sourceRefs, evaluatedAt, asOf, checkpointVector, generation, coverage, quality, missingRefs}`; delayed/gapped projection cannot authorize a current mutation |

All finalized fields are required unless explicitly nullable, with closed
unknown-field/major/enum handling. E/owners must publish exact schema variants,
limits, parser exports and policy references before implementation. Unknown
variants render unavailable/reject, never successful resolution or money movement.

## Candidate command/read families

| ID / authority | Request payload in addition to verified mutation/scope | Response and invariant |
| --- | --- | --- |
| W06-D-01 Support open/read case | Booking/customer beneficiary refs, category/reason policy, minimal bounded description, selected finalized purpose-bound Media refs; read cursor bound to current case/market/fieldset | Case/ref/revision, current permitted actors and evidence requirements; foreign/private case IDs leak no evidence; a case is not a refund |
| W06-D-02 Support resolution proposal/decision | Case ref/expected revision, resolutionKind under approved policy, reason, evidence refs/revisions, beneficiary relationship, requested B remedy link if allowed, approval ref when required | Durable resolution/decision/audit ref and pending/current owner results; conflicting case decisions refresh; financial remedy stays pending until B authority confirms |
| W06-D-03 Support→Billing remedy request / B authority | Stable resolution/refund business identity, case/Booking/payment/receipt refs/revisions, approved reason/policy/evidence and exact requested Money/beneficiary assertions | B accepted/rejected/pending/unknown refund operation and eligibility/remaining amount; D stores only the link and safe outcome; duplicate resolution cannot create another refund |
| W06-D-04 Support remedy/status recovery | Original case/resolution/B operation refs, current object/purpose scope | Independently revisioned case and B refund/posting/money facts, pending phase/failure/retry owner; failed refund never rewritten as resolved money |
| W06-D-05 Reviews eligibility read | Current customer/guest binding if explicitly accepted, Booking/completed-work refs/revisions and intended review purpose | C-owned immutable eligibility evidence evaluatedAt/revision and D accepted rule/policy result; exact eligible completion/cancellation/payment rule and lifetime must be approved |
| W06-D-06 Reviews submit/amend/moderate | Eligibility grant/ref/revision, Booking and current customer scope, bounded rating/text/evidence, expected review revision, moderation reason/policy; moderation authority separate from author | One durable review/business identity and audited revision; stale/revoked/foreign eligibility denied; same command replay is not a second review; moderation does not change Work/payment facts |
| W06-D-07 Communications template publication | Template/version, approved event/purpose/channel, bounded parameter schema, locale/copy/design approval, retention/expiry and required consent policy | Immutable published template revision/audit with compatible readers; publication/edit does not resend historical intents or create an unapproved marketing campaign |
| W06-D-08 A consent/current recipient read | Verified subject/customer or accepted guest, purpose/channel, consent-policy revision and relevant source resource/participant refs | Current permitted/denied/revoked outcome with evaluatedAt/source revision; no prior event cache overrides revocation or implies new consent |
| W06-D-09 Communications send/status/participant read | Authoritative source event/operation/resource refs, permitted template/version/purpose/channel and recipient authority ref; conversation read/send has current C membership epoch and ordered cursor | Durable notification/message/attempt receipt and current membership/history bounds; provider acceptance, verified delivery, browser receipt and read remain independent. A notification receipt never proves returned funds |
| W06-D-10 B Wallet scoped admin read/operation | Approved custody account/holder/purpose, B receipt/posting/settlement refs, expected Wallet revision, exact Money if mutation and independent approval/evidence when required | B durable custody/hold/reconciliation result and remaining references; no arbitrary balance edit, cross-currency arithmetic or shadow ledger; only published permitted actions |
| W06-D-11 B Subscription scoped admin operation | Subscription/customer/plan/policy revision, allowed freeze/resume/correct/entitlement transition, expected owner revision, active Booking reservation/use refs and approved reason/approval | Durable B operation plus independently sourced entitlement/reservation/financial outcomes; concurrent last entitlement is consumed once, cancellation releases once; no automatic charging assumed |
| W06-D-12 current recovery/report read | Exact owner operation/target and current actor/purpose; financial links, cursor/filter/scope/generation bound | Safe authoritative operation status plus separately marked D projection lag/coverage; reconnect/reload retrieves previous operation, not another mutation or stale invented success |

No exact URL, permission name, DTO copy or package version is frozen by this
table. E must reconcile routes with actual owner controllers and public clients.
Resolve independently authenticated admin, source-service and beneficiary roles;
knowing a Booking/payment/conversation UUID is never current access authority.
Guest resource/purpose/delegation expiry/linkage comes only from E's accepted
contract. Operations/Support access never implies Finance or moderation authority.

## Candidate events and cross-app recovery

Use E's immutable authenticated envelope: event ID/type/major/producer,
aggregate ID/revision, occurredAt UTC, correlation/causation and operation identity.
Proposed closed data families to review:

| Producer / event family | Required data / safe nullable fields |
| --- | --- |
| D Support resolution progress | Case/resolution/Booking refs, outcome, safe approved reason/policy, decision/audit time, B remedy-operation ref null until linked; no evidence bytes/contact data |
| B refund/remedy progress | Refund/payment/receipt/operation refs, source revision, actual requested/confirmed/refunded Money if required, posting links and policy/time; provider-result ref null while unknown |
| C verified review eligibility | Booking/work/customer opaque refs, eligible completion/source revisions, eligibility-policy ref/evaluatedAt/expiry/revocation; no private evidence/location or invented paid flag |
| D Reviews publication/moderation | Review/eligibility/Booking refs, revision and approved public outcome/rating fieldset, reason/policy/time; private moderation/evidence fields remain authorized reads only |
| A consent change | Subject/customer opaque ref, purpose/channel/policy revision, permitted/revoked outcome/effectiveAt; no contact address or broad all-purpose consent |
| C participant access change | Conversation/Booking/assignment scope refs, membership generation, affected opaque participants, purpose/effectiveAt/revision; old epoch cannot be revived by delayed events |
| D Communications intent/delivery change | Notification/source-operation/template refs, purpose/channel/recipient opaque ref, intent/attempt/outcome revisions; providerReceipt/deliveredAt/readAt null until their distinct evidence exists |
| B Wallet/Subscription progress | Owned operation/account/subscription/entitlement refs/revisions, accepted purpose/state and related Billing/Booking refs; Money only for authorized consumer need, no ledger secrets/customer funding |

Each app must display the original source operation, current authority/revision,
pending/unknown/failure/partial outcome and separately sourced financial or
entitlement status. Support resolution can coexist with refund pending; confirmed
review publication does not change payment; subscription freeze does not silently
cancel Booking; a sent notice is not completion. Freeze exact approved customer,
operator and admin recovery wording/states before the W06 barrier.

An approved source event→template/version→purpose→current recipient→channel matrix
is required. Reassignment/cancellation or consent/grant revocation fences read,
send, subscribe, reconnect and queued fanout through current owner authority.
Already delivered content cannot be unsent. Enforce purpose-specific private
Media authority; proof contents, message bodies, precise location, credentials
and signed URLs never enter generic events/logs or persistent browser caches.
OTP email is not evidence of SMS or Communications provider readiness.

## Idempotency, money/time, errors and compensation

Verified actor/service + owner/operation/target/business identity scope canonical
fingerprints, expected refs/revisions, reason/policy, Money, selected recipients
and meaningful payload. Same key/bytes recovers the original receipt after current
authorization; changed bytes conflict. Permanent resolution/refund/review/message/
reservation business uniqueness survives retry-cache expiry. Unknown results use
owner operation lookup/reconciliation rather than a new request/provider identity.
Reads do not get mutation idempotency keys.

Use exact B canonical minor-unit strings/currency/policy and no floats/default
scale/rate/fee. Separate owner revisions and UTC instants from accepted market
timezone display. E/owners must freeze exact bounds, deadlines/retry/lease/expiry,
consent/eligibility lifetimes, cursor/retention/replay/tombstone windows and reason/
approval limits from actual product/provider inputs; no magic defaults here.

Errors need closed safe codes for denied/revoked/foreign actor/object, stale
revision/eligibility/consent/membership, unsupported policy/schema, amount/currency
mismatch, duplicate business identity, ineligible refund/entitlement, unavailable
authority/capacity/provider, unknown external outcome, expired cursor and partial
compensation. Pending/refusal/transient failure remain distinct. Retry budgets,
terminal parking, authorized replay and every sensitive decision/export initiation
are durable audited facts with actor/scope/reason and owner operation links.

Each owner commits state/receipt/audit/outbox together; each D consumer commits
Inbox/hash/effect/checkpoint before ACK. Booking owns orchestration, Scheduling
capacity, Dispatch assignments, B monetary/custody/entitlement compensation, and
D Support/Reviews/Communications its own local state. Compensation has a distinct
stable identity and recorded outcome. No cross-service SQL or fabricated rollback
of posted money, completed work or delivered messages. Reporting rebuilds derived
contributions from approved history without resending notices or reissuing refunds.

## Compatibility, dependencies and provider/consumer gates

Publish supported-major/enum/required-nullable/parser compatibility, exact clients,
old/new reader/schema migration and deprecation evidence. Unknown shapes reject/
remain unavailable. Additive changes require old-reader proof; breaking changes
require explicit review and a new common base before affected consumers resume.
Append-only migrations preserve original financial/review/case history and local
audit. E owns every shared dependency/config/Gateway/broker/CI change request.

First accept narrow real A/C/B/E authority/binding/read providers, then D Support/
Reviews/Communications providers on their own DB/HTTP/constraints, then app
consumers and integrated customer/operator/admin recovery. Split cycles into
binding→provider→consumer; no fixture or unmerged app can close the first gate.
Required future tests include foreign/revoked private case/proof/membership,
competing resolution/review/refund/last-entitlement/hold operations, same/different
fingerprint and response-loss recovery, duplicate/hash conflict/order/crash/rebuild,
consent changes versus queued delivery, scoped export audit/freshness and actual
supported sandbox outcomes, plus Linux and separate Windows/device UI evidence.

These are **future W06 gates / NOT_RUN**, not W05 case additions. Request E's
accepted schemas/parsers/clients, dependencies/provider documentation, actor/service
grants, business subscriber topology/ACL/DLQ replay, isolated resources and actual
mandatory gate commands before BASE_W06. No automated next wave, live money,
production provider/refund operation, self-approval, merge or deployment is granted.
