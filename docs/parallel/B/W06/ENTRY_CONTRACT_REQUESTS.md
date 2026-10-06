# W06-B — entry contracts and child gate request

**PROPOSED_NOT_ACCEPTED / NOT_IMPLEMENTED.** Packet
`w06-b-wallet-subscription-entry/0.1.0` is a document revision, not an npm version.
No BASE_W06, executable business commands or new grants are published. Existing
W01/W05 closed candidate schemas remain unchanged. E and the authoritative
owners must accept exact closed schemas, version transitions and gates first.

## Common profile required for every request below

| Concern | Proposed requirement / decision to freeze |
| --- | --- |
| Owner/schema/version | Named producer and real consumers; separate command/read/event IDs; request, response and event schemas reject unknown fields/majors/enums. All listed fields required unless explicitly nullable or action-specific. Publish cross-field guards, bounded sizes, parsers/OpenAPI/AsyncAPI and exact public client exports. |
| Actor and guest | Reuse current Identity account/session/authVersion and service audiences. Producer checks current delegation, beneficiary/holder/Booking, market, purpose, object and action. Guest capabilities/linkage/claim/revocation require E/A/C acceptance. Phone matching, caller-provided IDs and administrative role names cannot confer ownership. Replay reauthorizes without freeing ambiguous resources. |
| IDs/revisions | Stable business identity, operation receipt, owner-qualified object references and expected aggregate revisions; original source/correction/Posting/Booking/hold/reservation/task IDs preserved. Resolve current integer versus opaque revision disagreement explicitly, without coercion. |
| Money/units | Candidate Money uses canonical nonnegative integer `amountMinor` string, `currency`, immutable `currencyPolicyRevision`; exact approved exponent/bounds/rounding/conversion/classification accompany it. No float, sample currency or zero fee default. Reserve/capture amounts positive; entitlement units bounded positive integers; views may expose real zero, unavailable values null. |
| Time | Canonical server UTC commit/effective/expiry timestamps; provider observation distinct. Freeze timezone, calendar rules, clock authority/skew, boundary equality and independent hold/benefit/capacity/command deadlines. Replaying a request preserves original expiry. No numerical lifetime invented. |
| Transition/receipt | Closed action-specific preconditions/outcomes; distinguish pending, rejected, confirmed and reconciliation required. Actual owner effect/receipt/audit/outbox commit locally; no transaction across DBs. No response state implies another owner's financial, capacity or benefit transition. |
| Idempotency | Scope by owner, contract major, authenticated initiator/delegation, action and target. Canonical fingerprint includes meaningful IDs/revisions, action, purpose, exact Money/units, policy, snapshot and source refs; specifies array order/set semantics. Same meaning returns original operation/outcome/refs; different meaning conflicts; concurrent pending shares one operation. |
| Permanent uniqueness/lifetimes | Cross-key credit/capture/activation/usage/task business uniqueness survives replay-cache cleanup. Approve replay receipt/tombstone, audit/evidence/event/backup retention and worker leases separately; minimize PII without erasing recovery/dedup authority. |
| Errors/UNKNOWN | Publish safe closed reason/recovery codes for validation/auth/concealed object/revision/key/policy/source/unavailable/deadline errors. Transport failure is UNKNOWN, not rejection. Query or replay the same durable operation with bounded accepted retry/exhaustion policy. Absent lookup and expired lease do not prove noncommit. |
| Compensation | Each owner records an independent compensation operation/receipt/fence. A terminal no-effect result must close future execution before value or units are released. Committed financial or usage effects require linked approved reversal/correction, not deletion. C owns capacity/assignment saga; B never writes C DB. |
| Compatibility | Preserve strict booking.confirmed.v1 and existing closed proposal payloads. New fields/states/actions need an explicitly reviewed separate contract or major, old/new parser and retained-event replay matrix. Do not import/copy private DTOs. |
| Provider gates | Actual owning DB/upgrade/constraints/runtime role, current Identity/HTTP, accepted parser/client conformance, audit/outbox/inbox crash and broker replay. Source/tag/tree/run binding and no production data. |
| Consumer gates | Real merged producers, independent subjects/guests and actual C handlers; full affected A/C/D journey before consumer merge. Fixture results labeled separately and never accepted as integration. |
| Packages/config/resources | E publishes exact contracts/event-contracts/api-clients versions, package/manifest/tsconfig changes, Wallet/Subscription/Pricing Gateway routes and error/precondition transport, audiences/delegation/grants, broker topology/ACL/DLQ/history, migration/runtime privileges and isolated run ports/DBs/queues/objects/browser/artifact paths. No E file edited here. |

Semantic candidates below define review requirements; they are **not** runtime
DTOs or approved defaults. For each, E must fill the exact route/event major,
scalar bounds, nullable variants, policy decisions and compatibility matrix.

## Request cards

### W06-B-01 — immutable plan/account/intent binding

Provider B Wallet/Subscription; prerequisite authorities Identity, Workforce or
Customer/guest binding, Catalog/Pricing and approved policy. Consumers B Billing,
C Booking, authorized A/D reads. Candidate request: holder/beneficiary reference,
purpose policy, immutable approved plan/Catalog/price/quote snapshots, expected
revision and business intent ID. Response: binding/intent reference, content hash,
owner revision, eligibility state, effective/expiry policy and operation receipt.
Event: owner-qualified binding/policy/revision/outcome refs, with no contact/proof.

Account kind/purpose and allowed currency partitions derive from B-07/08; customer
wash plan derives from B-09. Conditional customer funding/withdrawal/provider
product/recurring scope needs explicit inventory and policy approval. Intent is
not money or active benefits. Binding uniqueness and current object access need
real provider gates before Billing consumes it. No generic arbitrary-money API.

### W06-B-02 — confirmed postings, qualifying allocation and catch-up

Provider B Billing; consumers B Wallet/Subscription and scoped C/D. Request:
posting/allocation/journal/business-operation reference, known owner revision,
purpose/authorized fieldset and bounded cursor. Response: immutable source/business
effect, actual balanced journal/posting refs, exact Money and classification,
beneficiary/holder-purpose mapping, confirmed allocation, original/reversal refs,
committed time, revision/asOf/coverage or explicit missing/unavailable outcome.
Events publish separately closed confirmed-posting/allocation/correction variants
with causal refs, revisions, policy, exact authorized amounts and stable envelope.

Genuine received merchant credit remains distinct from allocation. Unallocated,
mismatched, disputed or classification-pending credit cannot fund Wallet/activate
benefits. Reversal does not delete the original. Cross-key source business identity
is unique. Account classification/refund caps/UNKNOWN exposure come from approved
B-03/06/11 policy/provider evidence; no invented suspense account or finality.
Validate balanced per-currency immutable entries and runtime UPDATE/DELETE denial
**after provisioning replay**; E's blanket role grants need an accepted solution.

### W06-B-03 — posting-backed Wallet credit, status and statement

Provider B Wallet, consuming B-02 real facts. Request: credit business identity,
account/holder/purpose and expected revision, actual posting/allocation refs;
asserted amounts cannot authorize credit. Response/event: applied movement/owner
revision, same source refs/policy, posted/held/capture-pending/available values and
source checkpoint/quality. Null source or stale/gap states are unavailable, not
fabricated zero or spendable pending value. Statement requests bind beneficiary,
fieldset, immutable asOf/cursor and purpose; expose only authorized owner facts.

Unique `(source posting, approved account, purpose, effect)` prevents duplicate
value even with different event IDs/keys. Correction links original movements and
actual new Billing effects. Real DB duplicate/gap/reversal-before-credit tests and
authorized catch-up are required. Custody balances and customer liability cannot
share availability, grants or presentation merely because they are called Wallet.

### W06-B-04 — reserve, capture authority and Billing execution fence

Providers B Wallet then B Billing, consumers B finalization/C Booking. Preserve
W01 closed reserve fields `schemaVersion/balanceHolderId/purposePolicyRevision/
bookingId/expectedRevision/money`. Deadline, beneficiary/binding, account-purpose,
operation and Booking lifecycle fence additions require a reviewed delta.

Candidate capture claim request: hold/Booking binding, expected revisions, exact
Money, purpose/policy, capture business identity and authorized Billing operation.
Wallet atomically replies with durable claimed authority, owner revision, original
hold expiry and command-bound fence/operation. Billing's capture request references
that real authority plus financial/Booking revisions and consistency assertions;
its response/event is actual posting or fenced terminal noncommit, or pending/
UNKNOWN with the same recoverable operation. Wallet finalization references those
actual results, returns one movement/terminal hold state and original causal IDs.

A claimed partition stays unavailable while Billing may still commit, including
after deadline/lease expiry or initiator revocation. Definitive noncommit must
fence late workers before restoration. A DB revision alone or a cached authority
read is insufficient. Real last-funds and claim/expiry/release races, commit-to-
Wallet crash gaps and delayed-worker-after-closure tests are mandatory.

### W06-B-05 — release/expiry compatibility and corrections

Provider B Wallet; consumers C/B recovery. W01 closed `wallet.hold-resolve.v1`
requires nonempty unique `billingPostingIds` for BOTH CONSUME and RELEASE. Preserve
that proposal. Request a **separate no-financial-effect release contract or new
action-discriminated major**, carrying real hold/Booking/purpose/revision,
release business identity, terminal authority/operation/fence and policy refs.
No empty refs or fictional posting. Response/event distinguishes actual released/
expired, pending, rejected and reconciliation outcomes, preserving original expiry.

Expiry cannot free claimed UNKNOWN funds. Partial capture, residual release,
post-capture refund/reversal and restoration require approved partition rules and
separate original/correction/posting refs. Deadline equality, reasons and new enum
states are explicit review items. Race every action in real DB/HTTP/provider tests.

### W06-B-06 — purchase, activation and lifecycle

Provider B Subscription with B-01 plan intent and B-02 financial facts; consumers
C/A/D. Activation request: business activation identity, purchase/beneficiary/plan
snapshots, expected revision and actual eligible allocation/posting refs. Response/
event: activation/term refs, policy, owner revision, effective/expiry times, actual
granted benefit buckets and financial refs, or pending/rejected/reconciliation.

Separate renewal/cancel/pause/resume/change commands bind original/new plan/term,
expected revisions, requested effective date, reason, approved policy and any
required financial operation. Return operation plus effective lifecycle result;
renewal pending/failure/UNKNOWN does not create active units or overwrite a still
valid prior term. No automatic charge/Booking. Rollover/proration/refund calculations,
grace and freeze/change behavior need B-09 approval and exact Money/time rules.
Real financial-commit-to-activation restart and entire lifecycle gates required.

### W06-B-07 — entitlement reserve/consume/release/expiry/history

Provider B Subscription, consumer C real new handlers and authorized A/D views.
Preserve W01 reserve `schemaVersion/subscriptionId/bookingId/expectedRevision/units`
and resolve `schemaVersion/reservationId/expectedRevision/action/bookingId/
policyRevision`, action CONSUME|RELEASE. New benefit bucket/term/binding/authority,
deadline or EXPIRED state needs reviewed contract versioning.

Reply/event/history: reservation/effect/term/Booking IDs, owner revisions, exact
units, original independent deadline, policy/source refs, closed operation outcome,
available/reserved/consumed counts or null with quality. Define actual consume
trigger and any required financial handshake before execution. Atomic last-unit
reservation and fenced consume/expiry/release yield one terminal effect. Releasing
an expired bucket cannot make it usable; consumed units need approved correction,
not RELEASE. Dedup activation/use across keys and cache cleanup. Real C last-unit
wash competition plus loser compensation is mandatory, not just a counter test.

### W06-B-08 — current Booking authority and durable compensation

Provider C Booking prerequisite binding/read/status; consumer B eligibility and
later C new command handlers consuming merged B. Request: Booking/financial intent/
saga expected refs/revisions, beneficiary, current lifecycle fence and purpose.
Response/event: current approved action authority, cancellation/work state,
independent capacity/financial/benefit operation refs, expiry and revision quality.
New C handlers persist step identities before Wallet reserve/capture/release and
Subscription reserve/commit/release. Actual command names/CONSUME mapping require
acceptance; do not add private aliases to closed payloads.

C compensates capacity, assignment and its saga. B resolves only its owned holds,
units and financial effects. Timed-out calls stay UNKNOWN; one late payment or
benefit result cannot resurrect cancelled Booking/expired capacity. Acquisition
and irreversible commit order require reviewed B/C/E protocol and real combined
purchase/approved funding→Booking→consume→cancel/release→failed-renewal evidence.

### W06-B-09 — privacy owner tasks/results and private export

D/E publish verified intake/task binding; B Billing/Wallet/Subscription execute;
C Media supplies real private artifact authority; A/D aggregate authorized status.
Current W06 includes fulfillment, superseding old B/W05 W07 scheduling. Request:
request/task/business IDs and versions, current verified subject/delegation/action,
explicit B data classes/fieldset, owner/policy revisions, assurance/deadline and
scope. Response/event: actual action, per-owner pending/partial/blocked/failed/
unknown/completed result, affected classes/revisions, retained exceptions/policy/
hold refs, completedAt nullable until actual completion and private evidence.

Freeze D ACCESS/RECTIFICATION/ERASURE/RESTRICTION/CONSENT_WITHDRAWAL versus old B
EXPORT/DELETE/ANONYMIZE mapping; preserve closed old proposal. Explicit Wallet
statement/hold and Subscription purchase/benefit classes cannot be silently folded
into CUSTOMER_RECEIPT_FACTS. Private export returns accepted manifest/asOf/coverage,
finalized object/version/checksum and authorized expiry/revocation/disposal facts.
No journal deletion, invented retention/anonymity or completion from ACK. See
[privacy proposal](PRIVACY_FULFILLMENT.md) for copy/backup/replay fulfillment gates.

## Proposed acyclic children — E must agree scopes/gates before coding

| Child | Real dependencies and narrow gate |
| --- | --- |
| W06-E-ENTRY | Accepted predecessor base/W04 custody/W05 providers; product/privacy/Money/lifetime inputs, actual C intent/Identity/guest bindings, shared publication, roles/topology/resources and commands |
| W06-B-POSTING-READS | After ENTRY and actual predecessor Billing: approved immutable posting/allocation qualification and scoped catch-up reads with real ledger/role/HTTP gates; supplies actual backing before Wallet claims |
| W06-B-BINDINGS | After merged POSTING-READS: minimum Wallet account/backing/credit/reserve/claim provider plus Subscription plan/purchase bindings, with real local DB/migrations/constraints/Identity/HTTP and final-funds/claim races; no dependence on final C consumer |
| W06-B-FINANCIAL-EFFECTS | After merged BINDINGS: actual Billing capture using its durable claim/execution fence and financial allocation for bound purchase intents; own actual ledger/role/recovery tests |
| W06-B-LIFECYCLE | After merged FINANCIAL-EFFECTS: Wallet projection/finalization and Subscription activation/lifecycle/reservations; actual producer conformance/DB races/restart gates |
| W06-C-BOOKING-BENEFITS | After merged LIFECYCLE: C's real new saga/commands against real Scheduling/B; full affected Booking flows before this child merge |
| W06-B-PRIVACY | After merged verified D/E task binding, B financial records and real C Media purpose provider: actual B fulfillment/status/export/retention gates; no final coordinator completion dependency |
| W06-A-D-CONSUMERS | After actual owners above: authorized apps, D privacy completion/reporting aggregation and every affected real journey before consumer merges |
| W06-E-BARRIER | All children merged through authorized process: latest combined source, all mandatory/affected business/privacy/journey gates, eligible independent review and verified resulting target before base advancement |

These are queued child scope proposals, not extra branches/PRs opened by this task.
No child starts from an unmerged peer branch. Exact providers/bindings are split
before final consumers to remove financial/entitlement and privacy cycles. Parent
stays NOT_STARTED now and INTEGRATION_PENDING once implementation begins; no DONE
from fixtures, inherited CI or proposal merges. No next wave is implemented here.
