# W05 payment, cancellation, rescheduling and refund requests

**REQUESTED / UNACCEPTED.** No package export, registry acceptance or BASE_W05
is published here. W04 cash acceptance and predecessor barriers remain absent.
Read the merged owner W03 W04 packets. Latest A/D proposals align with B's
amountMinor/currency/currencyPolicyRevision fields, while C/older packet adapters,
precision/revision/principal/policy/event profiles remain unaccepted. Agreement
in proposal text is not a published parser or owner/consumer conformance result.

## Common proposed external envelope

Candidate v1 commands carry `operationId, targetId, expectedRevision,
policyRevision` plus command-specific fields below. Verified actor, beneficiary
and service delegation come from authenticated transport; never trust body role/
owner fields. Proposed responses expose `operationId, status, targetRevision,
resultReferences, errorCode, retryAfterMs` with explicitly defined nullable fields.
Status must distinguish accepted/pending, applied, rejected and unknown transport
outcome; a timeout is not a rejected financial write.

Canonical Money proposal: `{amountMinor:string, currency:string,
precision:integer, currencyPolicyRevision:string}`; digits/negative permission,
maximum range/scale/rounding and exact names must be approved with B/D/A consumers.
Time uses server UTC instants, accepted expiry/skew rules and named
Asia/Damascus service timezone; no guessed price/hour/refund deadline.

Each owner defines actor+operation+resource-scoped key/fingerprint, atomically
stored replay result, changed-payload conflict, concurrent uniqueness, lifetime
and retained business uniqueness/tombstone. Current authorization is rechecked
on replay/status reads. Declare deadline, retryable errors, compensation identity,
unknown-outcome reconciliation, source revisions and durable outbox/inbox tests.

Proposed events carry the reviewed technical envelope plus minimum references,
Money where necessary, domain revision and policy version. No private image,
precise location, bank/account/QR data or credentials in events. Existing strict
`booking.confirmed.v1` payload `{bookingId,customerId}` is not silently widened;
guest compatibility or new events require an explicit accepted version.

## Owner-specific requests

| Request / authoritative owner                                              | Proposed command fields → replayable result / event                                                                                                                                                                                                                                                                                          | Required transitions, compensation and tests                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W05-PAYMENT-VERIFY / Billing B; private evidence Media C; E transport      | paymentIntentId, providerKey, merchantRef, providerTransactionReference, independentEvidenceRef, observedMoney, providerOccurredAt and immutable expected Money/beneficiary binding; server-authenticated verification evidence → verificationId, paymentRevision, ledgerPostingId or pending/rejected; candidate payment-verification event | Proof upload is review input; only authorized server verification posts. Duplicate callback/verification, signature/replay window, wrong amount/currency/merchant/owner, concurrent/out-of-order callbacks, lost provider response, raw technician approval denial and audit |
| W05-CANCEL / Booking C; policy Configuration D; financial effect Billing B | bookingId/revision, reasonCode, policyRevision → cancellationOperationId, resulting booking/capacity/assignment references and financialDisposition (pending until owner result); candidate cancellation state event                                                                                                                         | Approved cutoffs/reason/fees/current actor determine admissibility. Durable Scheduling release, Dispatch release and Billing disposition separately idempotent; no completion/cash erase. Test cancel vs assignment/start/completion/collection and every crash window       |
| W05-RESCHEDULE / Booking C; Scheduling C; Pricing/Billing B; Geo A         | bookingId/revision, old/new quote and obligation IDs/revisions, new availability/coverage revisions and requested window → rescheduleOperationId, old/new capacity+snapshot refs and separate Billing financial-amendment/compensation outcomes                                                                                              | Approve hold/commit/release order and price-difference policy; cannot silently lose old reservation on failed new commit or mutate history. Real last-slot/expiry/cancel/payment races; reconciliation/compensation for unknown owner results                                |
| W05-REFUND / Billing B; Support D may request, not post                    | originalPaymentOrCollectionId, requested Money, reasonCode, decisionReference, policyRevision → refundId, refundRevision, reversalPostingId, providerOutcome or pending; candidate refund state event                                                                                                                                        | Authorized current approver and server eligibility, cumulative refund bound, immutable reversals, cash custody/treasury implications and approved return method. Partial/concurrent/duplicate refund, callback reorder, ambiguous provider acceptance and restart            |
| W05-LATE-PAYMENT / Booking C + Billing B, Scheduling C                     | paymentVerificationReference, expired intent/hold refs, bookingRevision and policyRevision → compensationOperationId with separate accepted reacquire/refund/manual disposition                                                                                                                                                              | No automatic expired-capacity resurrection. Each owner persists its command result; real late callback vs expiry/race, pending compensation alert, retry/tombstone/no orphan effects                                                                                         |
| W05-FINANCIAL-READS / Billing B + Wallet B + Reporting D; E composition    | scoped query/cursor/revision inputs → receipt/obligation/refund/custody snapshots with immutable refs, projection source vector and staleness                                                                                                                                                                                                | Lossless Money, field masks, bounded queries, guest/object access, ETag304 only if accepted; no stale projection used as financial authorization                                                                                                                             |
| W05-GUEST-RECOVERY / Identity E; customer A; Booking C                     | reviewed operation ownership/linkage/expiry inputs → narrow recoverable guest authority and safe receipt/status lookup                                                                                                                                                                                                                       | Same browser/process restart result without session-demo fallback; revocation/abuse/CSRF/linkage/current scope, exact approved production disclosures and key lifetime                                                                                                       |

These candidate v1 schemas need concrete OpenAPI/AsyncAPI and package parsers
accepted by providers and consumers, including unknown/required/nullable fields,
errors and backward compatibility. Package versions remain contracts0.0.2,
event-contracts0.0.2, api-clients0.0.1; no version for these requests is accepted.

Refund allowance must be reserved transactionally against the original financial
effect so concurrent partial/full requests cannot exceed the accepted refundable
amount. Unknown provider outcome keeps that allowance reserved until independent
reconciliation proves success or rejection; a transport timeout cannot free it
for a second refund. Test local reservation, provider dispatch, callback and
finalization crash windows with durable current-authorized recovery.

Guest recovery is already a predecessor/W04 requirement; listing its compatibility
request here does not defer guest acceptance to W05.

## External policy and provider references required before publication

D/product/B must supply versioned real cancellation windows, fee/refund/partial/
cash-return/reschedule/late-payment rules, tax/currency precision, holder/purpose,
treasury acceptance and approval separation. Resolve employment versus marketplace
semantics explicitly; no payroll, customer stored-value or auto-debit scope is added.

Approved checkout choices remain Cash, ShamCash and Syriatel Cash. Wallet is an
internal owner. No Paymera owner requirement, merchant agreement or authenticated
provider documentation is accepted in the current source; its necessity remains
an explicit owner decision. Do not invent a fourth method or publish an adapter.

For each required electronic provider the packet must attach a verified official
documentation URL/version/retrieval date, authorized merchant/test-environment
reference, region/currency availability, API/callback authentication/signature,
idempotency/status-query/error/refund semantics and provider/consumer sandbox tests.
Current repository UI names/sample QR/receipts are not provider references.
**No official provider capability is asserted by this source-only audit.**
Live merchant operations, money/refunds and production execution require their
applicable explicit authorization after a concrete tested candidate exists.

## Configuration, compatibility and barrier

E requests reviewed public exports/clients/routes, verified actor/CSRF/delegation,
timeouts/status lookup, per-owner telemetry and exact impact gates. Infra requests:
isolated provider test endpoint, secrets outside source, owner DB migration jobs,
durable producer/subscriber topology and private Media origins/scanner. A–D submit
dependency changes; no peer imports, private DTO copies or DB cross-access.

Acceptance must include real owned DB+HTTP+Identity constraints, parser/provider/
consumer conformance, broker crash/replay/gap tests and affected actual apps.
Fixtures remain labeled contract fixtures. Publish BASE_W05 only after complete
W04 cash/adversarial results, independent review, unchanged refs, authorized
serialized merges and mandatory checks on the actual resulting target.
