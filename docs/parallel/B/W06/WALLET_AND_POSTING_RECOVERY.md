# W06-B — Wallet partitions and posting recovery

Status: **PROPOSED_NOT_ACCEPTED / IMPLEMENTATION_BLOCKED / BUSINESS_TESTS_NOT_RUN**.
Observed main: `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`, tree
`c5bd3137ef9d4e0ab7b70b9646e126f10e011883`. BASE_W06 is unpublished;
real W04 custody and W05 financial/provider acceptance remain missing.
Billing and Wallet contain ServiceMarker only and advertise foundation readiness false.
This document requests owner-reviewed behavior; it adds no models, migrations,
endpoint, financial state, accepted schema, dependency or runtime facility.

## Ownership and separate purposes

Billing owns verified received credits, allocations, balanced immutable journals,
captures, refunds and linked corrections. Wallet owns posting-backed accounts,
purpose partitions, holds, movements and reconciliation checkpoints. Wallet reads
public Billing contracts; it never reads Billing tables or creates a second ledger.
C Booking owns its durable orchestration; Scheduling owns capacity and its expiry.
An app, Reporting projection or broker delivery does not authorize money movement.

| Purpose | Required boundary |
| --- | --- |
| W04 technician/team cash custody | Actual collection/posting allocations, distinct collector/holder/receiver, handover declaration versus treasury acceptance and settlement. |
| Provider received funds/settlement | Billing merchant/finality/allocation facts; no automatic conversion into a technician balance or customer benefit. |
| Customer stored value, if explicitly approved | Separate product policy, customer liability/accounts, funding/withdrawal authority and eligible posting rules; approval is currently absent. |
| Customer wash subscription | Subscription-owned plan/benefit counts and reservations; units are not Wallet cash and cannot fund another account. |

B-07/B-08 must approve actual holder kinds, custody/spendable purposes and rules.
Naming an account or listing a technician/team/treasury candidate does not approve it.
The latest task's conditional funding/withdrawal scope remains explicit and blocked
until approved; this proposal neither implements nor silently removes that scope.
Marketplace/provider plans, payroll and automatic recurring debit need separate
express approval. Preserve guest cash, optional plate and approved checkout choices.

## Versioned balances and partition equations

Money uses the accepted currency, exponent, maximum and rounding policy, exact
integer-minor strings on the wire and exact arithmetic internally. No currency,
decimal precision, exchange rate, fee, tax or numerical lifetime is assumed.
Server UTC commit times, provider observation times and expiry instants are distinct.
Statements identify holder/purpose, immutable policy, owner revision and source coverage.

For one approved holder/purpose/currency, propose a signed reconciled custody fact:
`custodyNet = acceptedOpeningSource + sum(eligible signed Billing effects)`.
Every term requires actual source references and accepted sign/classification rules.
Custody shortage/overage or an approved adjustment may produce a signed discrepancy;
that is not an overdraft facility or a spendable customer balance. Preserve the
discrepancy and accountable resolution rather than clamping it to hide history.

For an expressly approved spendable partition, propose:
`available = eligiblePostedBacking - disjointUnresolvedEncumbrances`.
Encumbrances include unconsumed holds, capture-claimed amounts and any independently
approved restricted allocation, counted once per partition. Available must remain
nonnegative under atomic owner-local reservation; exact eligible-backing rules,
partition precedence, partial effects and correction treatment require approval.
W04 custody is not automatically eligiblePostedBacking for customer spending.

When a confirmed capture debit is applied, update mapped posting backing and close
its claimed encumbrance in the same Wallet transaction. Do not subtract both the
already reflected debit and the old claim, or remove the claim before applying it.
Pending/unallocated credits are not backing. Held, claimed, pending and captured
amounts remain separate facts; do not pool different currencies or holder purposes.
Missing source or unresolved gaps yield explicit unavailable/stale/partial quality
and nullable affected values, not fabricated zero, settled or additional availability.

## Posting qualification and durable business deduplication

Wallet credit accepts a reference to actual Billing evidence, not caller-supplied
money or arbitrary journal lines. Wallet verifies a confirmed eligible posting,
its source/allocation and holder/purpose/policy binding through authorized contracts.
Genuine unallocated merchant credit remains a Billing fact, but does not fund Wallet
or activate benefits. Wrong merchant or unproved finality cannot establish credit.

Propose unique business-effect mappings for `(posting, holder, purpose, effect)`
under approved split/allocation limits. Event-ID Inbox dedup is additional transport
protection, not the financial identity. Different event IDs or retry keys cannot
apply one posting twice; cache expiry cannot permit another financial effect.
Corrections reference immutable originals and apply their distinct approved effect
once. They do not delete history, reopen consumed holds or blindly restore value.

An owner transaction commits movement, balance revision, source checkpoint, audit
and Outbox together. Inbox identity/hash, accepted local effect and checkpoint
also commit together before ACK. Identical delivery replays; conflicting content
quarantines. An unrelated unique-constraint error is not successful duplication.
Check source causal references and owner revisions; there is no global event order.

## Reserve, durable capture authority and terminal resolution

Reserve checks current actor/service/beneficiary/holder/purpose authorization,
Booking binding, policy, source coverage and expected owner revision. Atomically
reserve the approved available partition and record the operation/receipt/expiry.
Two Booking requests, a handover and a hold cannot allocate the same backing twice.
Replay preserves original receipt and deadline; it cannot renew the hold implicitly.

Capture needs a narrow Wallet authority provider before Billing may execute:

1. Atomically claim an eligible hold partition for one capture business identity.
   Bind Booking/fence, exact Money, hold revision, policy and authorized Billing
   operation. A cached read or expected revision alone does not fence expiry.
2. Persist Billing's stable business/operation identity before any possible effect.
   Billing validates the command-bound authority and its accepted execution fence.
3. Billing commits the actual authorized balanced journal/posting, outcome, audit
   and Outbox locally. Wallet later consumes that actual source evidence once.
4. Wallet resolves claim/hold/backing with stable original references and a durable
   outcome. Response loss leaves queryable pending/reconciliation state.

Wallet and Billing have separate databases. No cross-database atomic commit or
rollback is claimed. Claim, Billing financial confirmation and final Wallet update
are distinct durable facts; intermediate states are part of the required protocol.

Pending/UNKNOWN Billing capture keeps its claimed partition unavailable even when
hold expiry, authority lease or worker lease has elapsed. Expiry is not evidence
that Billing did not commit. Recovery uses the same operation/key/exact meaning;
it never creates a replacement capture or frees funds to satisfy a timer.

Release of claimed backing requires an accepted definitive noncommit/closed result
for that same Billing operation **and a fence preventing any late worker commit**.
An absent lookup result, disconnection, timeout or expired lease is insufficient.
If source outcome is contradictory or still unknown, retain claim and accountable
reconciliation. Freeze current-authority revocation, operation registration,
terminal fencing and recovery semantics with E/B; invent no lease duration.

After Billing commit but before Wallet update, restart recovers the actual posting
and original capture authority. Duplicate reply/event/query applies one movement.
Confirmed consumed funds are not released by cancellation; Billing-owned linked
refund/correction and separately approved Wallet effect handle their disposition.
Revoking an initiating user does not free UNKNOWN funds. Approved service recovery
revalidates its own scope; reads and user replay still check current authorization.

## Closed draft release incompatibility

W01 `future-finance-contracts.schema.json` defines the closed proposed
`WalletHoldResolveCommand`: CONSUME and RELEASE both require `billingPostingIds`
with `minItems: 1` and unique items. It is not an accepted runtime API.
Preserve this draft's strict shape; C's optional outcome references do not override it.
Do not omit references, send an empty array or invent a journal to release a hold.

For approved expiry/release with no financial posting, request a separate release
contract or explicitly reviewed action-discriminated new major. Its exact real
release authority, operation, policy, Booking/fence and terminal result references,
nullability and compatibility must be published before execution. Until then the
no-posting release path is blocked. Enum presence never approves partial capture,
partial release, fees or restoration rules.

## Reconciliation and safe consumer facts

Persist owner-scoped cursors/revisions, stable financial operation references and
unresolved source dependencies. Duplicate/older/gapped/correction-first events do
not regress state. Catch up through bounded authorized Billing history/snapshot/
operation queries and compare original effect identities before advancing coverage.
Missing predecessor refs stay pending; snapshots cannot silently erase discrepancies.
Missing required subscriber bindings or exhausted recovery requires visible owner
review and accepted topology repair, not assumed delivery or repeated money commands.

| Consumer | Required truthful view |
| --- | --- |
| A customer | Only approved owned statements/status/benefits. Funding/purchase pending is not available/active; UNKNOWN capture/refund is pending with recovery identity. No team balance or new payment method. |
| C operator/Booking | Actual authorized hold/reservation and independent capacity/work outcomes. Lost reply triggers same-operation lookup; cancellation compensates each owner and never resets consumed funds locally. |
| D administration/Reporting | Source/as-of/checkpoint quality, separate cash custody, Wallet liability, earned amounts and unused benefits; distinguish declaration, posting, settlement and discrepancy without counting one receipt three times. |

Exact production states, fieldsets/copy and app mapping need A/C/D/product approval;
this table does not redesign or accept missing screens. Guest ownership and account
claim/transfer need accepted E/A/C contracts, not phone/plate matching or local state.

## Required provider gates and migration handoff

Future B migrations must add schema mirrors plus actual constraints/indexes for
accounts/partitions, business effects, holds, capture claims, operations, immutable
movements, Inbox/Outbox and checkpoints. Freeze exact names/types and migration IDs
only during authorized implementation. Enforce nonnegative approved availability,
disjoint allocation limits, terminal transition guards and persistent uniqueness.
Billing separately enforces per-currency balance, valid accounts and immutable
posted originals/reversals; a TypeScript assertion cannot enforce raw SQL behavior.

E's `infra/postgres/provision.sh` regrants runtime UPDATE/DELETE on all tables.
Require reviewed owner migration/privilege/immutability rules that survive repeated
provisioning, then real runtime-role denial tests. B cannot change shared provisioning.
Use accepted separate owner databases/roles; no peer Prisma imports or DB joins.

Required real DB gates include last-funds races, hold versus custody allocation,
capture versus expiry/release, lost Billing reply/restart, late worker after fenced
noncommit, duplicate credit/correction, gapped events and provisioning replay.
Real C handlers must then pass independent acquisition/commit/compensation deadlines,
cancel/rebook/expiry races and stable owner receipts against merged B providers.
Retain current auth, real broker commit/publish/ACK faults and A/C/D consumer gates.

E/B must publish exact idempotency scope, fingerprints, conflict and replay rules,
business tombstone retention, statement and cursor authorization, durations for
holds, grants and operations, command/query deadlines and bounded recovery policies. No foundation
default or numerical placeholder enables finance. Parent remains NOT_STARTED while
entry is blocked, then INTEGRATION_PENDING until combined-source required gates pass.
