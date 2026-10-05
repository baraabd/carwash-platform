# W03-D — W04 operations, custody and delivery contract requests

Status: **PROPOSED / UNACCEPTED**. This packet implements no W04 runtime and chooses
no published package version or wire endpoint. E/B/C and affected A/D consumers
must accept the exact schemas and publish them with verified **BASE_W04** before
dependent writes. Existing proposals remain inputs, not deployed contracts:

- B `docs/parallel/B/W01/FUTURE_FINANCE_CONTRACTS.md` and its schema: cash record/
  reversal, Wallet custody handover/acceptance and settlement references.
- C `docs/parallel/C/W01/CONTRACT_REQUESTS.md`: Dispatch/Work, current assignment,
  cash authority and private Media; C W02 proposal adds Booking/hold vocabulary.
- D W01 CP-D-003/006: Communications delivery and Reporting projections/recovery.

## Common required schema closure

`Ref` means a typed `{owner,id,revision}` resource reference; E must settle exact
ID/revision scalars, allowed owners, required/nullable fields and closed enums.
For review, `Money` refers to B's existing candidate
`{amountMinor,currency,currencyPolicyRevision}`; C's `{minorUnits,currency}` shorthand
requires an explicitly accepted adapter or common vocabulary. No silent field or
precision conversion. Money is exact decimal-string minor units with the approved
currency/exponent policy; no Number/float aggregation or mixed-currency totals.

Each command needs current verified actor/service scope, stable business operation
ID, expected revisions, reason/policy references and scoped idempotency identity.
Actor is derived by server authentication, never trusted from body/caller headers.
Fingerprint binds actor, operation/target, beneficiary/assignment, all expected
revisions, Money, purpose and policy; exclude transport secrets/request IDs. Same
key/bytes replays the original authorized receipt; changed bytes conflict. Durable
business uniqueness survives replay-cache expiry. E/owners must select exact
key/tombstone lifetimes, deadlines, expiry boundaries and recovery budgets.

Every authoritative result needs owner/resource/revision, closed operation/outcome
discriminator, server occurrence/evaluation time, immutable related references
and current operation lookup. Reads have no mutation key. UTC instants and explicit
market timezone interpret appointments/local dates; server receipt time differs
from offline capture time. Unknown outcome is pending/query/reconcile, not failure
or success. Events reuse the accepted envelope and authenticated producer identity;
names/versions below are existing **candidate** names only.

E/B/C must publish a provider/consumer compatibility matrix with supported wire
majors, parser/export versions, old/new reader tests and explicit migration/
deprecation gates. Unknown major/enum is rejected or displayed unavailable, never
guessed. Additive changes still require compatibility proof; a breaking dependency
requires reviewed schema change and a new common base before affected consumers
resume. Preserve strict existing V1 contracts instead of widening them silently.

## Required owner command/read schemas

| Request / owner | Required command fields and authoritative result | Decisions and failure/recovery semantics |
| --- | --- | --- |
| Dispatch create/reassign/release / C | Booking/reservation/Work refs, current team/operator/van/resource and eligibility revisions, expected assignment/attempt revision, action reason and assignment fencing identity → typed attempt/current assignment/operation receipt | Close active-assignment exclusion, accept/reject/release transitions and in-progress safety policy. Current Gateway dispatch route targets Booking; E must reconcile with Dispatch ownership. Stale grant/resource/fence conflicts; timeout queries same attempt |
| Assignment/Work authorized reads / C | Scoped Booking/assignment/Work refs or bounded market query → independently versioned assignment, Work phase, current eligibility/resource and appointment facts with source/as-of | Ordinary technician role is not assigned-work authority. Reassignment/revocation invalidates commands and purpose access. Stale Reporting cannot assign or start Work |
| `billing.cash-record.v1` / B with C authority | Stable collection ID; Booking/Work/assignment/obligation refs with **named expected revisions**, collector authority, declared collected Money, captured time and approved evidence refs → immutable cash receipt, accepted Money and Billing posting/operation refs | Reconcile B's single expectedRevision with C's multi-owner references. B validates actual current authority/amount. Partial/under/overpayment and offline-after-reassignment policy need decisions. Repeated receipt cannot collect twice; work-completed is not cash-received |
| `billing.cash-reverse.v1` / B | Cash receipt/expected revision, correction reason/policy and approved evidence ref → linked immutable reversal and posting/operation outcome | No historical deletion, arbitrary negative collection or unapproved refund. Concurrent reversal/handover races need explicit refusal/recovery and Wallet reconciliation |
| `wallet.custody-handover.v1` / B | Approved holder/purpose and recipient refs, expected custody/receipt revisions, bounded per-receipt allocations and exact declared Money → pending handover ID/revision, allocated/residual amounts and referenced Billing postings | Same cash cannot enter overlapping handovers. Holder is an approved custody actor, not customer stored value/payroll. Initiation is not treasury acceptance/settlement; timeout queries original handover |
| `wallet.custody-accept.v1` / B | Handover/expected revision, independent treasury evidence, observed Money and decision reason/policy → typed pending/mismatch/rejected/settled result plus required Billing receipt/posting references | Distinct current treasury authority; compare observed versus declared/allocated cash. Define mismatch remediation, cancel/reversal races and which owner coordinates durable Billing posting before settled status |
| Authorized receipt/custody/settlement/reconciliation reads / B | Bounded scoped IDs or market/holder/time/currency query with policy-bound cursor → immutable receipt/reversal/handover/posting refs, independent state, declared/observed/residual Money, source revisions/as-of and discrepancy status | No PII/proof bytes in generic rows. A receipt is financial collection; handover and settlement are movements of the same money, not extra revenue. Unavailable source remains unknown |

Published snapshots/events need enough market/Booking/holder/amount linkage for the
permitted projection. If events remain reference-only, B/C must provide authorized
immutable snapshot/replay/correction APIs with explicit retained windows. Close
`FinancialResult.state` and required Money per result discriminator; generic state
strings or optional Money cannot define a production financial contract.

## Reconciliation, freshness and audit

Candidate cash-recorded/reversed and custody pending/settled events must identify
owner aggregate/revision, source operation and causal receipt/posting/handover
references. Assignment/Work events independently carry their owner revisions and
permitted relation to Booking. E selects aggregate ordering/gap identity; message
arrival time or broker delivery tag is not a source version.

Proposed wire major **1**, package versions **TBD / unaccepted**. Required data
shapes below supplement the accepted envelope; they are schema requests, not
changes to strict `booking.confirmed.v1`. Owners/E must reject unknown fields and
close each discriminator before publication:

| Candidate event family / owner | Required data fields | Discriminator and nullable-field rule |
| --- | --- | --- |
| Cash recorded/reversed / Billing B | receiptRef, obligationRef, bookingRef, assignmentRef, marketRef, collectionId, operationRef, action, Money, occurredAt, originalReceiptRef | Proposed action RECORDED or REVERSED; originalReceiptRef null for recorded, required for reversal; Money is positive exact affected amount, direction comes from action |
| Custody pending/settled/correction / Wallet B with Billing evidence | handoverRef, marketRef, holderRef, recipientRef, operationRef, allocations[{receiptRef,postingRef,Money}], declaredMoney, observedMoney, outcome, treasuryEvidenceRef, settlementPostingRefs, occurredAt | Pending may have null observedMoney/evidence and empty settlement refs; SETTLED requires non-null independently accepted treasury evidence, observedMoney and required reconciled Billing postings. B closes mismatch/rejected/corrected variants |
| Assignment lifecycle / Dispatch C | assignmentRef, attemptRef, bookingRef, reservationRef, accepted Work ref, resourceRefs, eligibilityRefs, operationRef, outcome, effectiveAt | C closes created/accepted/released/reassigned variants and permitted null references; resource/eligibility revisions and fencing identity must bind current assignment authority |
| Delivery update / Communications D | notificationRef, sourceRef, recipientRef, purpose, channel, templateRef, attemptRef, deliveryState, observedAt, providerAcceptedAt, deliveredAt, readAt | Separate queued/provider-accepted/delivered/read/unknown/failed; timestamps null until that fact is established. D/E close channel/state/error enums using actual provider capability |

No document, proof, contact or signed URL belongs in these generic event shapes.
Any unsupported producer shape stays blocked; schema-valid refs still require
real scoped owner reads and current authority where decisions depend on them.

Reporting stores producer/event identity and byte hash, per-projection/generation
application identity, per-aggregate contiguous checkpoint and immutable permitted
audit provenance. Inbox/effect/checkpoint commit before ACK. Duplicate bytes do
not count twice; changed bytes conflict, older revisions do not regress state,
gaps remain partial until accepted repair. A reversal replaces the affected
contribution once. Rebuild cannot emit financial, assignment or delivery commands.

Each section exposes source owner/revision/as-of/availability and accepted coverage/
freshness policy. Missing sources never become zero or an unpaid badge. Operational
and financial totals remain separate; reconcile expected owner references and
posting evidence rather than adding receipt, custody and settlement as revenue.
Source-local audit is authoritative; Reporting outage cannot erase it or broaden
the authority to mutate source state. Exact lag thresholds and retention remain
owner decisions, not numerical defaults in this proposal.

## Communications delivery contract / D

Close a source-event → template/version → recipient/purpose matrix before enabling
delivery: assignment/reassignment/release and allowed Work progress to the current
assigned operator and authorized booking beneficiary; cash receipt to authorized
beneficiary/collector; custody discrepancy/settlement to approved treasury/holder
roles. No generic broadcast or new marketing purpose is implied.

Proposed request fields extend CP-D-003: stable notification ID, source event/ref/
revision, template ID/version, authorized recipient/member ref, purpose, accepted
channel, policy/consent reference, expiry and bounded typed parameters. Response
is a delivery receipt/revision with distinct queued/provider-accepted/delivered/
read/unknown/failed states. Providers must close exact enums, nullable fields,
errors and expiry semantics; provider acceptance is not end-user delivery/read.

Customer/guest and operator membership derive from accepted current Booking/
Identity/assignment grants; reassignment and revoked consent invalidate stale
recipient access. Recheck permission/purpose/consent at send and reconnect. Dedup
binds source identity, recipient, purpose, channel and template version; out-of-order
or superseded source revisions must not deliver obsolete assignment instructions.
An ambiguous provider send queries/reconciles the same operation, not blindly
resending. Actual channel/provider capability, retry/expiry and consent policies
remain required inputs. Email OTP proves neither SMS nor Communications delivery.

Conversation/read events need membership/object scope and stable sequence/cursor;
message/document bodies, signed URLs, financial proof and precise location do not
enter public events/analytics. Source replay or Reporting rebuild never resends
notifications. The existing Communications inbox unique-error classification
needs its own later real race/error regression before delivery acceptance.

## Provider/consumer gates and compensation

C accepts current Dispatch/Work authority; B accepts real collection/custody/
settlement with owned DB constraints, posting references, audit/outbox and unknown-
outcome recovery. Then D accepts Reporting/Communications ingestion and actual
delivery; A/C/D app consumers follow merged providers and full affected journeys.
No provider requires a future app to pass its owned DB/HTTP tests.

Tests must cover revoked/foreign assignment, concurrent assignment/fencing,
collection same-key/changed-key business duplicates, offline/stale authority,
amount/currency mismatch, partial receipts, overlapping handovers, distinct
approvers, posting timeout/crash, reversal/settlement races and exact per-currency
reconciliation. Broker/hash/order/gap/restart tests include INT-D-01 controls;
delivery tests include guest/operator membership, supersession/revocation,
ambiguous provider result, reconnect and no replay side effect.

Compensation stays with each source owner: release/reassign through C, linked
financial correction through Billing and custody remediation through Wallet's
accepted coordinator. No peer DB rollback, automatic balance adjustment or receipt
image-based settlement. C/B must resolve unpaid Work start/closure and custody/
employment policies. C's W03 draft #51 also records conflicting Booking-versus-
Workforce location ownership; E/C must settle the accepted Work/location owner
before D consumes such views or delivery events. E publishes accepted
contracts/clients/grants/broker ACLs,
resource allocation and compatible gate commands; missing policy/provider access
keeps the affected operation disabled. No live money/provider execution authorized.
