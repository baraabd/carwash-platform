# W05 electronic verification, private proof and compensation request

Status: **PROPOSED_NOT_ACCEPTED**. Request revision
`w04-b-w05-finance/0.1.0`; intended external command/event major **V1, subject to
review**. This is a request version, not a published package or accepted endpoint.
Accepted versions for these business requests: **none**. Observed source is main
`1ec9d8aebf4470a2815471116643fa6ebe0d5a95`, not `BASE_W04` or `BASE_W05`.

This is the next-wave handoff required by W04-B. W04 remains bounded to cash
collection, stable receipts, approved staff/team custody and settlement after its
entry requirements are met. This packet implements no W05 code, provider adapter,
refund, migration or app state. It neither publishes a common base nor authorizes
live money, merchant access or provider operations.

## Current truth and owners

At the observed source, `architecture/parallel-contract-release.json` still has
`BASE_W02: null`, no published W03/W04/W05 base, no accepted next-wave business
contracts and no reviewed release source/package versions. HTTP exports are
Identity/Gateway only; `@carwash/api-clients` exports an empty skeleton. Billing
and Wallet persist foundation markers, not obligations, receipts, custody or
refunds. Merged W01–W03 proposals do not provide functioning financial producers.

| Authority                                                                                                              | Owner and boundary                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Received-money verification, payment allocation, immutable journals, refund allowance/reservations and financial audit | B Billing; never customer proof, admin tables, Wallet or Reporting                                                          |
| Private proof object reservation, processing, scan, access, retention and deletion                                     | C Media; Billing holds authorized immutable references, not a public copy or Media database access                          |
| Booking cancellation/recovery and Work eligibility; capacity and assignment independently                              | C Booking, Scheduling, Dispatch and Workforce through accepted APIs; money does not recreate capacity or assignment         |
| Beneficiary and current customer relationships                                                                         | A with E Identity; verified initiating actor remains distinct from beneficiary                                              |
| Review/finance UI and derived reconciliation views                                                                     | D admin/Reporting; decisions invoke the owning producer and never post journals locally                                     |
| Typed policy publication                                                                                               | D Configuration with product/accounting approval and B applicability validation; Configuration owns no payment/refund state |
| Contracts/parsers/clients, service delegation, grants, routes/errors, broker ACLs and isolated test allocation         | E with affected producer/consumer review and independent approval                                                           |

The approved customer methods remain `cash/sham/syriatel`. Internal Wallet is
not a fourth checkout method. No customer funding/withdrawal, payroll, marketplace
or recurring debit is introduced. Paymera's launch requirement and relationship
to an existing method remain W01 decision B-02; no silent exclusion or new method
is inferred from its name.

## Shared schema closure and compatibility

`AcceptedMoney`, `OwnedResourceRef`, `VerifiedSubjectEnvelope`,
`OperationReceipt` and `AcceptedEventEnvelope` below are semantic references to
future E-published schemas, **not** locally defined production DTOs. Every row
requires exact required/nullable/unknown-field rules, closed outcome/error enums,
bounds, export/parser names and provider/consumer compatibility fixtures before
freeze. The closed W01 future-finance JSON schemas stay unchanged; extra fields
here are explicit delta requests requiring a reviewed release/common base.

IDs are opaque owner-issued values: a displayed order code, transaction hint or
merchant label is not authorization. E must freeze exact ID syntax, typed owners,
entity/operation/policy revision scalars and comparison rules. Keep owner entity
revisions distinct from event `aggregateVersion`; do not convert opaque policy
revisions into safe integers. Money uses canonical integer minor-unit strings,
accepted currency/exponent and immutable currency/accounting-policy references.
No float, guessed exponent/rate, currency conversion or mixed-currency sum is
permitted. Provider native encoding requires a reviewed lossless adapter.

| Incompatibility observed in existing proposals                                                                                                         | Required release decision                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI and registry use `sham`; W01 electronic `PaymentIntentCommand.method` uses `shamcash`                                                               | Publish an explicit compatible method/provider mapping; keep cash and electronic verification separate                                                |
| F001 service catalog reserves `billing.payment-confirmed.v1`; B requests `billing.payment-verified.v1`                                                 | Select exact financial event semantics/names and compatible parsers; no alias from proof-reviewed, intent-created or custody-settled to paid          |
| B `amountMinor/currencyPolicyRevision`, C `minorUnits/currency`, D's differing field/revision proposals                                                | One lossless published money/ref vocabulary or reviewed versioned adapters; these are minor-unit string proposals, not major-unit decimal conversions |
| W01 proof has `mediaObjectId` and optional transaction hint; new review requires purpose, object/version and evidence provenance                       | Explicit closed-schema delta plus producer/consumer tests; never append hidden fields to strict V1                                                    |
| W01 generic `FinancialResult.state` is an open string with optional money                                                                              | Publish discriminated outcomes with exact required amounts/refs and authoritative source; no generic success wrapper                                  |
| Strict existing `booking.confirmed.v1` contains only Booking/customer IDs                                                                              | Preserve it; separately publish reviewed guest, cancellation, financial and eligibility contracts rather than widening the strict parser              |
| Current Identity has member sessions and broad `billing.refund`/`verification.review`, but no accepted guest/merchant-verifier/refund approval profile | Publish exact current object/market/purpose/service grants; a role name or Workforce review permission is not payment-verification authority          |

All times are bounded server UTC instants under the accepted format. Keep provider
occurrence time, merchant statement time, Billing observation/commit time and
local display timezone distinct. Provider finality/cutoffs, skew, proof/intent
expiry, command deadlines and replay/retention windows remain approved-policy
inputs. A read or replay does not extend them.

## Proposed command and read requirements

Every mutation carries accepted schema version, stable logical business operation
identity, scoped `Idempotency-Key`, expected owner revisions, applicable policy
refs and current verified actor/service authority. Actor, guest and delegation
are established by authentication, never trusted body fields. Body money/owner/
merchant/status assertions are independently validated. The current Gateway key
alphabet `[A-Za-z0-9_-]{16,128}` is a compatibility input, not a new business grant.

| Request ID / intended surface and owner                                                  | Required request schema                                                                                                                                                                                                                                                                                                                     | Required authoritative response                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W05-B-01 `billing.payment-intent.v1` / B                                                 | Obligation/Booking refs, expected obligation revision, accepted electronic method, unique intent business ref and provider/policy selection constraints; amount/recipient derived server-side                                                                                                                                               | Billing intent ID/revision, obligation/Booking binding, immutable accepted Money and approved merchant alias/ref, protocol instructions only from genuine accepted provider evidence, expiry, distinct pending/unknown/unavailable outcome and operation/audit refs; no paid result from intent creation                                                                                                                                                                                      |
| W05-B-02 `billing.proof-submit.v1` / B with C Media                                      | Obligation/intent refs, expected review/obligation revision, unique submission business ref; nonempty normalized transaction hint or owned private Media object/version ref, or both; approved purpose/policy refs                                                                                                                          | Stable review case/submission ID/revision, accepted hint/object refs and server receipt time; received/processing/review-required/rejected outcome and safe reason, operation/audit refs; no verified-payment amount/posting merely from submission                                                                                                                                                                                                                                           |
| W05-B-03 review claim/decision and current evidence access / B with C/E                  | Review case/expected revision, scoped independent reviewer, bounded decision/reason/policy and independent merchant evidence ref when financial verification is requested; object-specific read purpose for Media                                                                                                                           | Durable review/claim decision with initiating actor/beneficiary separately, evidence provenance and operation/audit refs; request-more-info or proof rejection does not erase real money; receipt of proof/review completion alone cannot mark paid                                                                                                                                                                                                                                           |
| W05-B-04 `billing.settlement-verify.v1` / B internal verifier                            | Obligation/intent and expected financial revision; approved provider/recipient merchant; external transaction ID; independently obtained evidence ref/version/hash/protocol provenance; observed Money, credit direction/finality, provider occurrence/observation times and applicable policy; unique verification/allocation business ref | Immutable received-credit/evidence ref when final credit to the approved merchant is independently established, with separate matched/unallocated/mismatch/disputed disposition. Payment ID/revision, obligation-paid allocation and applicable receipt/journal refs require accepted matching/policy/duplicate checks; unproven evidence stays pending/quarantined/rejected. Include typed reason and operation/audit refs; late verification separately flags required Booking compensation |
| W05-B-05 cancellation assessment/read and Booking cancellation command / B read, C write | B: Booking/obligation/payment refs and purpose; C: current Booking/Work/reservation/assignment refs/revisions, stable cancellation operation, actor, approved reason/policy, applicable B assessment ref                                                                                                                                    | B reports exact financial facts, permitted assessment revision/validity and proposed allowable refund/charge treatment under approved policy; C returns durable cancellation/release/compensation refs and independent state. Neither read nor cancellation itself refunds money; B revalidates allowance at reservation                                                                                                                                                                      |
| W05-B-06 `billing.refund-reserve.v1` / B                                                 | Verified original payment/expected revision, unique refund business ref, requested AcceptedMoney, original allocation/Booking/cancellation refs, approved reason/policy and required independent approval/support-decision ref                                                                                                              | Refund ID/revision, exact reserved/remaining allowance, original payment/merchant/allocation refs, reserved/pending/refused outcome and operation/audit refs. Support decision authorizes only its accepted scope and cannot execute or confirm money                                                                                                                                                                                                                                         |
| W05-B-07 refund execution/status reconciliation / B internal provider boundary           | Refund/reservation refs/revisions, stable provider operation and documented idempotency/query identity, approved independent execution grant; destination derived from accepted original-payment/refund protocol                                                                                                                            | Durable provider operation ref and not-sent/pending/unknown/definitive outcome with evidence refs, query/reconciliation state and safe error. Provider request acceptance or a transfer screenshot is not refund completion                                                                                                                                                                                                                                                                   |
| W05-B-08 `billing.refund-resolve.v1` / B internal verifier                               | Refund/expected revision, original payment and provider operation refs, independent evidence ref/version/hash, confirmed or definitively-failed discriminator, observed exact Money/currency/time/finality and required approval/policy                                                                                                     | On proven confirmation: immutable linked refund receipt/reversal journal refs and consumed allowance; on proven terminal failure: released reservation once with no reversal. Pending/unknown cannot use a terminal discriminator or release allowance                                                                                                                                                                                                                                        |
| W05-B-09 late-payment compensation status/command / B financial owner, C coordinator     | Late verified payment/obligation/Booking refs, expected relevant revisions, original reservation expiry/cancellation evidence, stable compensation operation and approved disposition/reason/policy                                                                                                                                         | Separate financial fact and durable compensation-needed/pending/refund-reserved/confirmed/definitively-refused outcome. C reports its own original Booking/capacity state; a new booking requires new current quote/capacity acceptance                                                                                                                                                                                                                                                       |
| W05-B-10 scoped payment/review/refund/operation/audit reads / B; derived views / D       | Exact owned resource/purpose or approved bounded market query; scope-bound cursor/generation and current grant. Reads have no mutation key                                                                                                                                                                                                  | Discriminated owner states, immutable Money/receipt/posting/evidence refs only in approved fieldsets, revisions/evaluatedAt; D source/checkpoint/asOf/coverage/freshness and unresolved discrepancy owner. Missing/stale sources remain unknown, never zero/paid/refunded                                                                                                                                                                                                                     |

Proof intake preserves the approved either-or rule: at least a valid nonempty
transaction hint or authorized processed private image is required. W01's candidate
hint uses 4–64 Arabic/Latin/digit/space/underscore/hyphen characters; exact canonical
normalization and duplicate/replacement semantics must be frozen compatibly.
An image-only request still requires real object existence, current authority and
Media processing evidence; a structurally valid ID does not supply them.

## Private evidence and independent review

Request a distinct Media payment-proof purpose bound to beneficiary, obligation,
intent/review case and permitted submitter/service. Media reserve/upload/finalize
and read operations validate current object-level purpose/ownership, bounded MIME/
size/checksum, quarantine and scan/processing revision. Unsafe/unscanned/deleted/
foreign/revoked objects are inaccessible for review. Billing may acknowledge a
pending upload but cannot treat it as usable verified evidence. Scan success proves
an access/processing prerequisite, not authenticity or receipt of money.

Private references contain owner/object/version/purpose linkage, not raw bytes,
permanent URLs or access tokens. Short-lived scoped retrieval, revocation after
assignment/reviewer/guest changes, audit of every read/download and approved
retention/deletion/legal-hold outcomes require C/E decisions. Generic events,
Reporting exports and customer receipts expose no transaction hint, merchant
secret, proof image, signed URL, phone, address or plate. Retention values are open;
neither the prototype nor this packet supplies a duration.

Current member or capability-protected guest can submit/read only its own linked
resource under the accepted guest profile. Guest expiry/revocation/claim does not
silently transfer financial ownership; recovery must use E/A's accepted process.
An administrator initiating for someone else records both identities and current
object/market authority. Operator assignment permission does not grant electronic
verification, refund execution or private merchant-history access.

Request separate submit/review/verify/refund-reserve/approve/execute/reconcile
grants with current session/auth version and service audience/delegation checks.
Independent evidence must originate from approved merchant/provider/bank authority,
not the customer's image or return URL. Review/approval separation and thresholds
need B-06/B-11 policy; do not allow a submitter or requester to self-approve by
changing UI role. Same-login parallel sessions do not satisfy independent review.
Provider signature validation authenticates a documented message; the financial
owner still checks merchant, reference, direction, amount, finality and uniqueness.

## Transitions, uniqueness and unknown outcomes

The following semantic transitions are requests for closed enums, not implemented
states. Intent creation precedes transfer/verification; proof intake precedes
processing/review; review can ask for information/reject proof without changing a
verified payment. Independent accepted final credit evidence and the applicable
matching/accounting policy are required to transition an obligation allocation
to verified and post once. A reversal/dispute
creates a new linked correction state; it never edits the original receipt/journal.

Separate independently established received merchant credit from allocation to an
obligation. Wrong amount/currency/reference or an unknown Booking can prevent
allocation without erasing a genuine credit to the approved recipient. Keep that
immutable received-credit/evidence identity and explicit unallocated/disputed
disposition visible for B-owned reconciliation. Its journal classification and
permitted return/refund workflow require approved accounting/provider policy;
no suspense account, automatic allocation or refund is invented. Evidence for a
different merchant or with unproven signature/finality cannot establish receipt
by this business. An unallocated credit is not an obligation-paid or Work-eligible
fact, and the same external identity cannot later allocate twice.

Refund allowance must be checked atomically in Billing against accepted original
payment/allocation and policy. For each currency/payment, confirmed refunds plus
all active reserved/in-flight/unknown refunds cannot exceed the approved refundable
cap. Fees, partial/overpayment, cash refund delivery and cap derivation are open
decisions, not an assumption that every collected unit is refundable. Repeated
requests for one refund business identity reuse one reservation even with different
keys. Distinct approved partial refunds may each reserve their amount atomically,
provided confirmed refunds plus outstanding reservations never exceed the cap;
denied requests produce no journal/provider effect. A partial refund preserves the original total
and linked exact refunded/reserved/residual amounts; it does not change history.

Proposed refund progression is reserved → execution-pending → outcome-unknown or
independently confirmed/definitively-failed. Unknown retains its allowance; it
cannot age into failure or be replaced by a new refund. Cancellation of a not-sent
reservation requires durable proof no provider effect started. Releasing on terminal
failure needs documented finality; contradicting later evidence is quarantined for
owned reconciliation, not a second debit or optimistic reservation release.
Confirmation, linked balanced reversal, allowance consumption, receipt, audit and
outbox commit atomically in Billing. Wallet/Reporting apply referenced effects once
and never operate a second ledger. Cash corrections/refunds also retain custody/
settlement links; cancellation cannot erase collected cash or reset it to unpaid.

Freeze idempotency scope over owning service, contract major, current verified
initiating actor/service delegation, operation and target/create business scope.
Canonical fingerprint binds beneficiary, method/provider/merchant, all meaningful
money/currency/policy/expected revisions, original allocation, evidence refs/hash,
reason/approval and cancellation/compensation identity. E/owners must freeze
set/order/duplicate semantics for allocations/evidence; do not sort privately.
Exclude credentials, CSRF, signed URLs, trace/request IDs and volatile transport
timestamps. Business capture times remain meaningful if accepted by the schema.

Same scoped key/fingerprint returns the original durable authorized outcome after
current access checks; changed payload conflicts. Durable intent/submission/
verification/allocation/refund/compensation business uniqueness survives replay
cache expiry. External transaction uniqueness is `(provider, recipient merchant,
external transaction ID)` with its immutable evidence/allocation identity; one
credit cannot discharge two obligations without an explicitly approved split
allocation policy. No new key creates another financial effect after response loss.
Replay/tombstone periods, concurrent pending response, maximum provider retries,
query budgets and reconciliation escalation owners/times remain open fields.

Timeout, disconnection, 5xx, broker delay and uncertain callback delivery are
unknown outcomes. Query the same durable operation/provider identity using the
actual documented protocol; reconcile until evidence closes it. Do not prompt a
second payment, send another charge/refund with a new key, release refund allowance
or call the booking unpaid merely because a response is absent. Error schemas need
safe distinctions for auth/object/review denial, stale revision, policy unavailable,
amount/merchant/currency/reference mismatch, duplicate/conflicting evidence, unsafe
Media, invalid transition, unsupported provider, pending/unknown and reconciliation
required. Gateway coarse mappings need E review; no private provider exceptions or
PII leak to callers.

## C service eligibility and late-payment matrix

C owns execution eligibility. B supplies authoritative financial facts and a
versioned policy assessment, never a client `serviceAllowed` boolean. Every action
also requires current Booking/Work/assignment, valid capacity where applicable,
current Identity/workforce authority and approved operational rules. This matrix
is precise about safe boundaries; policy-dependent permissions remain **OPEN**.

| Financial and operational facts                                                                     | Eligibility/disposition requested for C                                                                                                                           | Unresolved approval/input                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cash due; original Booking/reservation/assignment current                                           | Work may proceed only if approved cash-after-service timing permits that phase; due is independent of custody/settlement                                          | B-07/B-13 collection timing and unpaid Work start/closure policy; prototype cash-after-wash display is not a production grant       |
| Cash collected; treasury custody unsettled                                                          | Payment/collection fact can coexist with unsettled custody; do not make treasury acceptance an inferred customer unpaid status                                    | Approved C phase rules and B custody/discrepancy policy                                                                             |
| Electronic intent/proof/review pending, rejected proof or ambiguous provider outcome                | No inferred electronic-paid eligibility. Any permitted unpaid exception requires an explicit policy/grant and audit; default absent policy is unavailable/refused | B-06/B-11/C exact prerequisite policy; proof/scan/reviewer navigation never enables Work                                            |
| Independently verified timely electronic payment; original reservation and assignment still current | Re-evaluate current operational/policy guards; verification satisfies only the approved financial prerequisite                                                    | Published matching Money/finality and C phase/eligibility policy                                                                    |
| Payment verifies after capacity expired or Booking cancelled/released                               | Record money separately; original expired capacity/assignment stays expired/released, original Work cannot restart from this event                                | B/C approved late-payment disposition and refund/compensation authority; new booking revalidates current Catalog/Pricing/Scheduling |
| Cancellation with collected/verified funds                                                          | C cancellation and resource release remain distinct from B refundable assessment/reservation/completion and Wallet reconciliation                                 | B-06 windows/no-show/completed-work/fees/partial refund and C cancellation safety rules                                             |
| Refund reserved/in-flight/unknown/confirmed, or verified receipt later disputed                     | Preserve history and independent facts; no automatic restart, unpaid reset, capacity restoration or cancellation rollback                                         | Current C phase policy and reviewed B dispute/refund disposition; unknown stays pending                                             |
| Any required policy, current authority or authoritative source unavailable                          | Refuse the dependent mutation with a typed unavailable reason; show honest financial/eligibility unknown state                                                    | Accepted recovery/expiry/freshness policy; neither cache nor Reporting supplies missing authority                                   |
| Work completed but amount remains due or disputed                                                   | Completion remains an authoritative Work fact; publish separate permitted unpaid follow-up/financial recovery                                                     | Approved collection/correction/access policy; no deletion of work or fabricated receipt                                             |

Booking's durable compensation record binds original request, financial operation,
expired/released reservation, reason/policy and each owner's operation refs. Billing
may reserve/execute an approved refund only under its own current allowance and
authority. Compensation has a distinct stable idempotency/business identity and
visible pending/exhausted/escalated outcome. Source replay cannot restore capacity,
dispatch a new technician, resend an irreversible transfer or retry compensation
with a replacement identity. Rebooking is a separate explicitly confirmed journey.

## Event schemas and D reconciliation examples

Every proposed event uses the reviewed envelope, authenticated producer ACL,
stable event ID, exact schema/major, owner aggregate ID/version, correlation/
causation and server occurrence time. Data rows below supplement the unchanged
strict existing contracts; they do not publish event IDs. Money is present only
in an approved consumer fieldset; otherwise authorized immutable snapshot reads
must supply the referenced facts with accepted retained windows.

| Candidate family / producer                                                                                      | Required data shape for freeze                                                                                                                                        | State/nullability and consumer boundary                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing.payment-intent-created.v1` / Billing                                                                    | intentRef, obligationRef, bookingRef, method/provider mapping ref, policyRef, expiresAt, operationRef                                                                 | Creation establishes pending intent only; no receipt/posting/paid claim                                                                                                    |
| `billing.proof-review-requested.v1` / Billing                                                                    | reviewCaseRef, submissionRef, obligationRef, bookingRef, reviewPurpose/policyRef, operationRef                                                                        | No proof bytes/hint/signed URL; authorized B/C read retrieves only approved evidence                                                                                       |
| Financial verified event, `billing.payment-verified.v1` versus reserved `billing.payment-confirmed.v1` / Billing | paymentRef, obligationRef, bookingRef, immutable receipt/allocation/posting refs, accepted Money if permitted, verification/policy refs, committedAt, lateDisposition | Verified requires independent evidence and committed financial effect. Late disposition is a closed normal/compensation-required discriminator, not a Booking state change |
| `billing.refund-reserved.v1` / Billing                                                                           | refundRef, originalPayment/allocation/Booking refs, reserved Money, policy/approval refs, operationRef                                                                | Reservation is pending financial recovery; no confirmed reversal or released allowance                                                                                     |
| `billing.refund-confirmed.v1` / Billing                                                                          | refundRef, originalPayment/allocation refs, refundReceipt/reversalPosting refs, confirmed Money, independent evidence/policy refs, operationRef, confirmedAt          | Confirmation requires committed evidence-linked posting; no provider request or proof image substituted                                                                    |
| `billing.refund-failed.v1` / Billing                                                                             | refundRef, originalPayment ref, definitive failure/evidence/policy refs, released reservation ref, operationRef                                                       | Only documented terminal failure permits release; unknown is a separate pending status, never this event                                                                   |
| Late-compensation/eligibility invalidation / Billing and C own separate facts                                    | source-owned payment/Booking/reservation/compensation refs and revisions, typed disposition, policy/operation refs                                                    | Exact event names and nullability require owner/E freeze; no cross-owner state mutation or combined fictional aggregate                                                    |

D examples below are **illustrative reference/state relationships only**, with no
real merchant, customer or amount and no executed endpoint capture:

| Reconciliation example                                   | Authoritative observation and expected derived behavior                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment-example` verified, `refund-example` reserved    | Billing's original receipt/journal remains immutable. D shows verified payment and a separate pending refund with reserved amount/ref; pending amount is not confirmed refunded or available for another refund                                                                             |
| Refund response lost after provider acceptance           | Same durable refund/provider operation is unknown, allowance remains reserved; D exposes recovery owner/status. Lookup/reconciliation closes it; no duplicate refund, zero outcome or automatic retry                                                                                       |
| Refund-confirmed event arrives before referenced payment | D Inbox/hash records delivery and leaves the affected contribution partial until authorized source repair; it does not fabricate a payment or sum a negative unlinked amount                                                                                                                |
| Cash paid with unsettled holder custody                  | Billing receipt identifies collected money; Wallet separately reports holder/handover/pending settlement and Billing refs. D does not add receipt, handover and settlement as three revenues                                                                                                |
| Late verified credit for expired reservation             | Billing receipt is real financial truth; C reports expired/released reservation and compensation refs. D shows both facts and an assigned recovery workflow, never restored availability                                                                                                    |
| Evidence/ref/amount conflict or projection gap           | Source owner preserves immutable audit and any independently established received credit, separates unresolved allocation, quarantines conflicting evidence and exposes discrepancy identity/owner. D reports incomplete/stale coverage until accepted repair; missing rows never mean zero |

Audit fields require immutable local audit/business-operation IDs, initiating actor
and beneficiary separately, accepted service delegation/audience/grant version,
merchant/provider aliases, evidence provenance/hash/parser revision, original
payment/allocation/refund/cancellation refs, exact money/policy, before/after owner
revisions, reason/outcome, independent reviewer/approval refs and server commit
times. Never store secrets/tokens/private proof in generic audit events. D access
and exports are bounded by purpose/object/market and approved retention/redaction;
Reporting cannot approve or execute financial recovery.

Billing commits state, audit and Outbox atomically with the receipt, journal and
allowance effects applicable to that transition under approved policy. Intent/proof
creation does not imply a financial posting or refund allowance mutation.
Consumers commit Inbox/raw-payload hash, owned effect and checkpoint before ACK.
Duplicate bytes are no-op; same producer/event identity with changed bytes is
quarantined; old revisions cannot regress state. Gaps/reversal-first/refund-first
arrivals use accepted owner snapshot/replay reads. E must publish durable
queues/bindings before activation, broker ACLs, replay windows/DLQ authority and
rebuild semantics. Reporting rebuild or broker replay never sends a provider
command or notification again. No distributed exactly-once promise is made.

## Provider dossiers and release blockers

[W01 provider evidence](../W01/PROVIDER_ACCEPTANCE.md) is historical limited public
research recorded on 2026-10-05, not fresh protocol validation. It records Paymera
API advertising without specifications, incomplete ShamCash retrieval and Syriatel
merchant-history capabilities without verified machine/refund protocols. All three
dossiers remain `DOCUMENTATION_AND_ACCESS_PENDING`; this packet makes no new
provider-capability claim. Unofficial SDKs, same-name services, screenshot OCR or
wallet automation are not approved provider evidence.

Before W05 dependent implementation, obtain through authorized owners the genuine
effective merchant agreement/account access, responsible contact, versioned
authentication/signature/key-rotation docs, recipient/transaction binding, currency/
denomination/fees, status/finality/reversal semantics, statement/export and full/
partial refund protocol, idempotency/query/reconciliation behavior and actual
sandbox/test merchant evidence. Sandbox availability is unverified; do not invent
one. Credentials and actual account numbers stay outside repository artifacts.

An independently sourced merchant history/bank record route is only a proposed
manual option requiring approved access, provenance/parser/checksum, operator/
review separation, matching, duplicate controls and private retention. Customer
proof can aid search but cannot satisfy independent verification. Merchant account
onboarding is not transaction verification; wallet closure/balance return is not
a merchant transaction refund. No provider calls or real-money operation occurred.

Applicable W01 decisions B-02/03/05/06/07/11/12/13/14/15 remain open where not
explicitly resolved: launch provider scope, exact currency/amount/finality,
replay/deadlines, cancellation/partial/overpayment/refunds, independent authority,
cash custody refund treatment, actual merchant protocols/access, evidence privacy/
retention, operational eligibility and missing production states/guest recovery.
E publishes the accepted schemas/versions/clients/routes/grants/typed policies,
runtime identities/resources and broker topology only after provider/consumer and
independent review. Missing applicable policy/provider authority fails closed.

## Proposed acceptance and next action

All tests in this packet are **NOT_RUN_SPECIFICATION_ONLY**. No real DB, broker,
HTTP, Media, provider, browser or money acceptance is claimed. Required future
provider cases include transactional payment/refund persistence and migration/
privilege/immutability; same-key replay/changed-payload conflict/different-key
business duplicates; merchant-scoped external-ID uniqueness; two-verifier and
partial-refund reservation races; exact large amounts/bounds/currency mismatch;
signature/account/reference/direction/finality rejection; Media foreign/quarantine/
scan/revocation/guest expiry; self-approval refusal; crashes before/after provider
send/commit/outbox/ACK; response loss, unknown outcome and definitive evidence
resolution without a second charge/refund. Upgrade uses the real accepted prior
business baseline, never marker-only schemas relabeled as financial data.

Actual consumer acceptance then proves duplicate/reordered/hash-conflicting/gapped
events, refund-first/late-credit recovery, Wallet/Reporting source reconciliation,
guest/current-grant HTTP refusal and real A/C/D proof/review/cancellation/refund/
status journeys against merged producers. Preserve Arabic RTL/seven customer steps,
optional plates and locked operator/admin references; missing production states
need exact product/design approval and canonical reference/candidate/diff evidence.
Fixtures remain labeled and cannot close provider/app acceptance.

Queue narrow accepted Identity/Media/financial primitives and genuine documented
verification providers first, then refund/late-compensation providers, then C
coordination and A/C/D consumers against merged real producers. Avoid requiring a
future app's complete journey for the first provider's owned DB/HTTP acceptance;
the parent remains integration-pending until all task cases pass together. E must
construct latest-target candidates, obtain independent review and verify the actual
resulting target before publishing `BASE_W05`. Stop at W04's reviewed handoff;
this request neither starts W05 nor marks W04 or full launch DONE.

Source inputs: [W03 B cash/custody request](../W03/W04_CONTRACT_PACKET.md),
[W03 Billing durability/accounting design](../W03/BILLING_DESIGN.md),
[W01 financial reservations](../W01/FUTURE_FINANCE_CONTRACTS.md),
[closed proposal schemas](../W01/future-finance-contracts.schema.json),
[open policy register](../W01/POLICY_DECISIONS.md),
[C Work/assignment request](../../C/W03/W04_CONTRACT_REQUESTS.md),
[D audit/reconciliation request](../../D/W03/W04_CONTRACT_REQUESTS.md),
[E entry truth](../../E/W03/README.md) and
[E topology/next-wave requirements](../../E/W03/TOPOLOGY_AND_W04_REQUESTS.md).
Current exports, registries, schemas and frozen references take precedence over
historical proposal intake/status descriptions.
