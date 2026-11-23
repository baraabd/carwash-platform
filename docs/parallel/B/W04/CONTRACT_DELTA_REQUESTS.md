# W04 cash, receipt and custody — Contract closure requests

Status: **PROPOSED_NOT_ACCEPTED**, request `w04-b-cash/0.1.0`.
Intended external major V1 subject to E review; accepted package/contract versions:
none. This refines the merged [W03 W04 request](../W03/W04_CONTRACT_PACKET.md)
and A/C/D W03 packets; none becomes an accepted runtime DTO or endpoint here.
The W01 closed future-finance schemas are preserved, not silently widened.

## Shared profile and exact closure

E/B/A/C/D must publish one public lossless minor-unit Money profile, currency/
exponent/policy refs, owner resource/revision types, account/guest beneficiary
binding, actor/service/delegation envelope, operation/key/status and event schemas.
B opaque revisions versus C/D numeric revisions, C minorUnits versus B amountMinor,
D exponent/policy-version fields and cash/sham/syriatel versus shamcash naming
remain explicit compatibility decisions. D also uses integer minor-unit strings;
no major-unit conversion or lossy numeric coercion is implied.

Below, AcceptedMoney/VerifiedSubject/OwnerRef/OperationReceipt/AcceptedEventEnvelope
are **semantic references to future public exports**, not defined private types.
Freeze exact fields, required/nullable/unknown handling, identifiers/bounds/enums,
UTC timestamps, state-specific money/link presence and version compatibility
before implementation. Schema-valid IDs do not grant object/account/assignment access.

| Request / owner                                          | Request schema closure                                                                                                                                                                                                                                                     | Stable response / actual fact                                                                                                                                                                                                   | Proposed event closure                                                                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CASH-REQ-01 Billing collection                           | Obligation/Booking/Work/assignment refs with named expected revisions/fence; unique collection business ref; declared AcceptedMoney; accepted collection/accounting policy; offline capturedAt as evidence only; authenticated current actor/service/collector and subject | Immutable receipt/posting refs and exact accepted amount; due/collection state/revision independent of Work; operation/audit refs, server commit time; original replay remains stable                                           | Accepted producer envelope + collection/receipt/obligation/Booking/posting refs, financial revision/policy/time; not full contact, private proof or sensitive account data |
| CASH-REQ-02 Billing receipt/status/download              | Exact receipt/obligation/operation ref; current account/guest/delegated beneficiary access; accepted format/fieldset purpose and scoped artifact access if required                                                                                                        | Authoritative original immutable money/quote/booking/receipt ID, approved safe fields and linked correction/current financial status; stable approved document identity; source revision/as-of; no legal invoice label invented | Reads emit no money event; any artifact/audit reference is separately authorized and never payment confirmation from download                                              |
| CASH-REQ-03 Billing correction/cancellation compensation | Original receipt/posting/obligation, expected financial revision, stable correction child key/business ref, approved reason/evidence/policy and critical authority                                                                                                         | Linked immutable reversal/adjustment or explicit pending/rejected/refund-compensation outcome; original receipt/postings preserved; exact affected amount/revision and original operation lookup                                | Financial correction fact with original/new refs, accepted direction/reason and source revision; Booking cancellation does not emit fabricated unpaid state                |
| CASH-REQ-04 Wallet custody/approved hold                 | Holder/account/purpose and source Billing receipt/posting refs; exact allocation/residual Money; expected Wallet/source revisions; stable business/key identity and current object authority                                                                               | Stable movement/hold refs, approved purpose and allocated/residual amounts; source checkpoints, authority/as-of and pending/reconciliation state; no second ledger                                                              | Reference-backed custody/hold fact with Wallet revision and Billing source provenance; hold grants no customer spending or checkout method                                 |
| CASH-REQ-05 Wallet handover/deposit                      | Current holder/recipient, expected handover/custody revision, deduplicated per-receipt/posting allocations, declared Money, approved evidence/purpose/policy, stable business/key identity                                                                                 | Pending handover/allocated residual refs and operation/audit; declaration is not independent treasury acceptance; overlap conflicts under accepted allocation policy                                                            | Pending handover/deposit refs, safe holder/recipient/purpose and source vector; no settled money from an initiating declaration                                            |
| CASH-REQ-06 Billing settlement / Wallet reconciliation   | Freeze coordinating owner; handover/receipt/posting expected refs, independent current treasury authority/evidence, approved observed Money/discrepancy policy and unique settlement identity                                                                              | Billing authoritative balanced settlement refs/outcome first; Wallet verified reconciliation and final custody revision, or pending/disputed/missing-source; same operation recovers after either reply/projection loss         | Separate Billing settlement and Wallet reconciled facts with causal original posting/receipt/handover refs and revisions; settlement is not another customer collection    |
| CASH-REQ-07 B operator/admin reconciliation queries      | Scoped holder/market/Booking/currency/period/purpose filter and accepted cursor; current actor/object/fieldset authority; source-generation binding                                                                                                                        | Due/collected/held/allocated/handover/settled/discrepancy independently sourced, exact per-currency values, immutable audit/operation refs and quality/as-of/coverage; bounded redacted rows                                    | Derived projection events cannot authorize collection/settlement or create source money; reference-only events need actual permitted owner snapshot/catch-up APIs          |

## Cash identity and authority race decisions

Freeze the unique original collection identity/cardinality with the approved full/
partial/overpay policy. Actor-scoped request keys alone cannot prevent two collectors
or new offline keys from duplicating one obligation effect. Accepted installments,
if required, need explicit reviewed business identity/remaining-due semantics;
do not turn arbitrary attempt IDs into new payable effects or silently discard
required policy. The task baseline real cash order still yields one stable receipt.

Current C authority must bind collector, obligation/Booking/Work, assignment fence,
eligible phase and revocation. Freeze where validity linearizes relative to Billing
commit and how a raced reassignment/revocation is recovered. No preflight grants
indefinite permission, and no shared peer DB or fictional atomic transaction is used.
Reassignment cannot transfer already held cash; custody uses a separate authorized
holder/receiver transition. Distinct beneficiary/actor/collector/holder/treasury
identity and market/object scope stay auditable, including admin delegation.

## Transactions, replay and unknown outcome

Billing atomically commits authorized balanced posting, stable receipt, obligation
update, operation result, audit and Outbox. Wallet commits owned custody/allocation/
hold/handover, result/audit/Outbox; Inbox/hash/effect/checkpoint precedes ACK.
Raw runtime SQL and concurrent line finalization must not bypass per-currency
balance, account usage, immutable posted history or unique financial references;
controls remain effective after provisioner replay. E owns shared infra changes.

Publish the canonical fingerprint including schema/command/actor/subject, immutable
source refs, named expected revisions/fence, money/purpose/policy/evidence and exact
allocation-list normalization. Same scoped key/fingerprint replays the original
authorized result; different payload conflicts. Permanent business uniqueness
survives accepted retention/tombstones. Lifetime/deadline/no-op revision rules
remain unapproved; no numerical defaults are chosen. Exclude credentials/CSRF/
trace IDs from safe fingerprints/logs. Current access is rechecked on replay/read.

Lost commit responses use the same operation/key or authorized status. Billing
settlement committed before Wallet update is reconciled by original posting refs,
never a second settlement. Gapped/reversed/late source events preserve pending/
disputed state and use authorized immutable reads/replay. Bounded retry/DLQ and
exhausted-work ownership are explicit; no global order/exactly-once claim is made.

## Errors, compensation, audit and consumer compatibility

Freeze safe reasons for wrong owner/foreign booking, unassigned/revoked/stale
collector/fence, missing obligation, already-collected business ref, changed-key
payload, amount/currency/policy mismatch, invalid phase/state, overlapping allocation,
insufficient approved-purpose available custody, self/unapproved settlement,
missing/reversed posting, evidence discrepancy, upstream unavailable/unknown timeout
and stale/partial projection. Missing source is never zero or guessed success.

Canceled Booking cannot erase collected cash or receipt. Approved corrections use
linked append-only Billing effects and Wallet reconciliation; refund request/reserve/
verification is separate W05 acceptance. Discrepancy result must identify authority,
reason, evidence/expected-observed references, pending owner/workflow, approved next
command and audit rather than auto-write off a shortage. No tolerance is invented.

Audit links actual actor/service/delegation/beneficiary/collector/holder/receiver,
current scope/fence, policies, original quote/Booking/operation/receipt/posting/
handover/settlement IDs, source revisions and server times. Approve safe privacy/
retention and downloadable receipt fields; do not expose tokens, proof bytes,
signed private URLs, merchant/account secrets or unrelated customer records.

A receives current customer/guest receipt/status/download semantics; C receives
due/collected/handover views and exact approved Work payment eligibility; D receives
redacted per-currency reconciliation/audit/discrepancy and independent settlement
authority. Production copy and missing receipt/custody/error/critical confirmation
states require exact A/C/D design approval, preserving frozen references. Package
major/error/state unknowns stay unavailable; no fixture or private adapter enables
production. E settles backward-compatible revisions and freezes new common base
for any breaking dependency, including the strict customerId Booking event.

## E wiring and acceptance handoff

Request exact contracts/event-contracts/api-clients/security-kit/platform-messaging
dependencies, parser/client exports, Identity grants/guest receipt capability,
Gateway routes/errors/CSRF/download transport, Billing/Wallet broker publisher and
all required durable subscriber bindings/ACLs, owner reconciliation/replay access,
isolated runtime/migration/broker/browser resource allocation and executable gates.
Current Gateway Billing summary/refund and foundation probe topology are insufficient.
Every mandatory CI job and explicit affected frontend build/typecheck remains required.

Provider acceptance uses real Billing/Wallet PostgreSQL/HTTP/Identity/C authority,
quoted obligation and broker fault recovery; consumer acceptance uses real A/C/D
completion, collection, authorized receipt download, custody and treasury settlement
with source vectors and actual reference/candidate/diff plus device evidence where
applicable. A customer may be paid while custody remains unsettled. Discrepancies
retain explicit owner/workflow. All new cases are NOT_RUN in this proposal.
See [W05_CONTRACT_PACKET.md](W05_CONTRACT_PACKET.md) for the conditional next-wave
request; no W05 implementation, policy approval, live money or automatic merge follows.
