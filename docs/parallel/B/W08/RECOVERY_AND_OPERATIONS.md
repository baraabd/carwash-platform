# W08-B — Durable recovery and bounded operations proposal

Status: **PROPOSED_NOT_ACCEPTED / IMPLEMENTATION_BLOCKED / REQUIRED_TESTS_NOT_RUN**.
Observed main is `f0b76221c1a1991ba78327c019f0b4a0a7c53dff`.
BASE_W08, full financial providers, frozen finance contracts, isolated resources
and approved recovery/performance budgets are unpublished. This document defines
reviewable owner protocols; none of its family names is an existing API, command,
worker, dashboard or accepted contract. It grants no permission to operate on live
providers, money or production data. Parent W08-B remains `NOT_STARTED`.

## Recovery rules and separate authorities

Billing owns obligations, verified collection, allocations, immutable balanced
journals, refunds and financial correction evidence. Wallet owns eligible
posting-backed partitions, holds, movements and custody reconciliation;
Subscription owns benefits and their reservations; Pricing owns promotion
exposure and immutable quotes. C owns Booking orchestration and Scheduling
capacity. Reconciliation consumes accepted owner APIs/events, never another
owner's tables, Prisma client or private DTO.

For each owner, persist the original business identity, exact canonical command
fingerprint, operation/receipt, causal source references, policy and owner
revision, unresolved dependency, next eligible recovery condition and audited
attempt history. Local state, effect, audit, receipt and Outbox commit together;
Inbox identity/hash, accepted effect and coverage checkpoint commit before ACK.
Business uniqueness survives different retry keys and transport-cache expiry.
Do not convert every unique-constraint error into successful duplication.

Recovery reuses the original operation and economic meaning. A timeout, missing
lookup result, expired lease, expired hold or revoked initiating session proves
neither remote noncommit nor permission for another effect. An `UNKNOWN` outcome
retains its exposure until authoritative resolution. A terminal negative result
used to release exposure must fence every late worker from committing that same
operation. Without a queryable, accepted terminal-fencing protocol, resolution
is blocked and escalated; it does not become a successful release.

Current Identity/owner authorization applies to every operational read, replay,
repair and evidence access. Financial decisions fail closed when authoritative
authorization is unavailable. User revocation does not free uncertain funds;
recovery uses a separately authorized service identity and its current bounded
scope. Recovery workers cannot inherit an initiating user's cached grant or
arbitrary repair authority from access to a queue.

The proposed reconciler durably claims one eligible owner operation with a
revision/fence, records the original dependency lookup identity, and commits
its observation and resulting eligible local transition atomically. Competing
or delayed workers compare that fence before writing. Bounded retry preserves
the same operation identity and attempt history across restart. Unsupported
event versions/hash conflicts quarantine without advancing complete coverage;
out-of-order or missing predecessors wait for bounded owner history recovery.
An exhausted attempt remains discoverable and auditable outside the leaseable
work queue. Durable scans require an accepted stable cursor and gap accounting,
so checkpoint advancement cannot hide an unresolved earlier resource.

## Owner recovery protocols

| Unresolved fact | Owner protocol and allowed durable result | Forbidden shortcut |
| --- | --- | --- |
| Orphaned Billing intent or lost confirmation reply | Read the original durable intent/operation and accepted external transaction status. Preserve authenticated merchant credit independently of allocation. Reconcile its original obligation, receiver, exact currency/amount and uniqueness. Adopt an actual confirmed posting once, or retain an explicitly unresolved/unallocated/disputed fact with owner review. | New payment identity after a timeout; proof image as money; invented obligation/credit; erasing received funds because Booking is missing. |
| Billing capture committed, Wallet effect missing | Wallet reads the eligible actual Billing posting and original command-bound claim. Apply the uniquely mapped holder/purpose/effect once; update backing, claim/hold, movement, audit, source coverage and Outbox in one Wallet transaction. Resolve missing predecessors through bounded owner history before advancing complete coverage. | Caller-supplied credit; replacing a missing posting with a zero or adjustment; closing a claim before applying its actual debit; counting both the reflected debit and old claim. |
| Wallet claim outcome unknown | Retain claimed backing outside availability, including after expiry/restart/revocation. Query the same Billing operation. Consume only actual eligible posting evidence; release only on accepted definitive noncommit plus a no-late-commit fence. Contradictory evidence remains a recorded discrepancy. | Lease expiry as noncommit; blind retry with a new capture key; availability restored by an administrator toggle. |
| Subscription activation/reservation gap | Validate actual eligible Billing allocation/posting before activation. Recover original reservation and fulfillment attempt through accepted C/Subscription authorities. Last-unit consume, release and expiry compare current owner revision and execution fence. Preserve already valid prior-term benefits while a new purchase/renewal is unresolved under the accepted policy. | Pending payment as active benefits; expiry releasing a claimed unknown attempt; consumed history changed to unused; refund automatically restoring units. |
| Promotion reservation/commit gap | Pricing reconstructs original held/claimed/used exposure from its authoritative records and causal accepted attempt status. Commit transfers that exposure once; release requires an eligible unclaimed local transition or claimed terminal noncommit fence. An approved restoration is a separate linked decision with permanent effect uniqueness. | Unknown exposure removed at TTL; projection rebuild replenishing counters; cancellation/refund automatically restoring quota; a new guest token resetting a cap. |
| Provider submission/refund uncertain | Billing retains the original registered provider operation, request fingerprint, merchant identity, native references and outcome observations. Follow the provider's accepted inquiry/retry rules using the same operation identity. Apply authenticated final success once; preserve pending allowance/claim while uncertain. Unverifiable or conflicting messages are quarantined without financial effect. | Generic retry under a new key; unsigned status as finality; treating HTTP success or delivery ACK as money; required-provider acceptance claimed from a fault fixture. |
| Duplicate/concurrent refund or disputed cap | Billing atomically checks confirmed plus unresolved reserved refund exposure against eligible captured source funds in the same currency and policy. Confirmed refund appends its immutable linked effect; definitive fenced noncommit releases only that reservation. Subscription eligibility fencing, benefit correction and promotion restoration are independent owner decisions. | Pending refund counted as confirmed; captured amount rewritten; concurrent benefit use invalidating an already admitted refund; second-key duplicate creating another return. |
| Collection/custody/treasury discrepancy | Reconcile actual Billing collection allocations, Wallet holder/purpose movements, physical count/declaration, accepted handover and independent treasury acceptance/settlement using original references. Record source coverage and signed difference under approved classification; preserve unknown components and accountable review. | One receipt counted as collection, handover and settlement income; unexplained shortage clamped away; customer balance created to balance custody; inventory/work state used as receipt. |
| Late payment after capacity expiry | Billing preserves actual collection and its original intent. C reads authoritative Booking/Scheduling facts and decides accepted independent compensation/rebooking. B reports financial outcome and authorized remedy; a new Booking needs current quote, capacity and benefit/promotion authority. | Financial reconciliation recreating capacity, assignment or completed work; late receipt mutating an expired Booking into confirmed. |

The W01 closed proposed `WalletHoldResolveCommand` requires nonempty unique
Billing posting references for both CONSUME and RELEASE. No-posting release
therefore requires an accepted separate family or reviewed new major; this
proposal does not widen the old draft, invent a posting or send empty references.
Partial capture/release, rounding, currency exponents, refund eligibility,
benefit/promotion restoration and cash adjustment rules remain actual approval
inputs, not defaults chosen by a recovery worker.

## Bounded operational reads and alerts

Proposed family labels for E/B review are `finance.recovery-query.v1`,
`finance.recovery-detail.v1`, `finance.reconcile-preview.v1` and
`finance.repair-command.v1`. These labels name a requested closed profile, not a
shared DTO or executable CLI. Each owner exposes only its resources and accepted
public dependencies. Gateway has no repair database. D consumes owner facts;
E owns routes, Identity grants, broker topology, secret handling and infrastructure.

Every read requires current actor/service identity, approved action, owned object
or bounded owner scope, purpose and classified fieldset. Query predicates are
allowlisted, with an accepted finite page/scan bound, stable owner cursor, time
window and resource/status filters; caller input cannot supply arbitrary SQL,
unbounded sorts or cross-owner joins. Cursor integrity, expiry and fieldset
binding require the accepted profile. A cursor never bypasses renewed authority.

Return source/as-of time, owner revision, coverage/gaps, unresolved operation IDs,
safe causal references and quality (`complete`, `partial`, `unavailable`, or
accepted equivalents). Unknown amount components are nullable with reasons;
they are not zero. Details remain object-authorized even after a list succeeds.
A reviewer grant does not grant access to every customer's proof or receipt.
Private media content, tokens, provider secrets, raw proof payloads and private
merchant/contact data are excluded from logs and queue/alert metadata. Authorized
evidence access goes through C's accepted object-scoped Media authority.

| B-owned signal requested | Required honest fields and detection basis | Operational owner/dependency |
| --- | --- | --- |
| Stalled/unclaimable Outbox and blocked Inbox | Resource/version, operation/event ID, attempt phase, lease/fence, persisted age, last safe outcome and source coverage. Include exhausted/unclaimable rows, not only currently leaseable rows. | B owner workers; E topology/ACL/availability and accepted retry/dead-letter budget. |
| Failed or unknown compensation | Original saga/child identities, independent owner outcomes, retained exposure, terminal fencing state and safe last failure. | B owners plus C coordinator; actual command/status contracts. |
| Unprocessed/invalid/conflicting provider observations | Provider/merchant scoped identity, safe native correlation, authenticated/unauthenticated classification, ingestion revision and unapplied reason. | Billing plus provider-owner protocol; E access/secrets. |
| Aging or discrepant cash custody | Actual holder/purpose, distinct collection/handover/treasury references, coverage/as-of, unresolved discrepancy and approved age category. | Billing/Wallet facts; D bounded views; approved accounting and custody policy. |
| Wallet/benefit/promotion gaps | Missing causal references, held/claimed exposure, owner checkpoint/gap, blocked operation and expected next authoritative dependency. | Wallet/Subscription/Pricing plus actual Billing/C providers. |

Alert thresholds, queue limits, scheduling frequency, maximum retries/backoff,
age categories and escalation recipients require E/owner-approved budgets.
Persist attempt and escalation state so restart does not reset the budget.
Exhaustion preserves the unresolved fact and exposure and raises accountable
review; it does not return financial success. Neither this proposal nor a green
foundation job establishes an alert installation or measured latency.

## Audited repair commands

Repair preview is read-only and reports exact source coverage, proposed owner
transition, expected revision, prerequisites and financial consequences. It
does not lock authority indefinitely or approve execution. An execution request
requires current scoped actor/delegation, approved purpose, reason code and safe
reason text, original operation/effect references, expected owner revision and
accepted fence, exact policy and event versions, durable repair business identity
and canonical fingerprint. Validate current authority again at the owner boundary.

An owner transaction atomically admits the permitted transition and records
original versus resulting revision, causal evidence, actor/authVersion, reason,
receipt/audit and Outbox. Repeated same identity/meaning resolves the original
receipt under current read authority; changed meaning conflicts. Different keys
cannot repeat the same correction, refund, release or restoration business effect.
An unknown repair outcome uses its original operation lookup and never issues a
replacement blindly. Optimistic previews, stale leases and operator double-clicks
are not authority to override a terminal fence.

Permitted repair categories must be individually accepted: retry the same
registered operation under its provider rules; reapply an actual source-backed
missing projection/effect once; catch up an owner history cursor; or submit a
separately approved linked correction. They do not include generic set-balance,
set-paid, reset-counter, delete-journal, force-release or recreate-capacity actions.
Direct SQL is not an operational fallback. Schema/role defects return to their
owner and E's provisioning gate; no repair weakens immutable posting constraints.

## Restore and W09 boundary

E provides genuine owner snapshots, restore coordination, replay cut positions,
resource isolation and accepted restore objectives. B's W09 packet must correlate
actual immutable journal totals per currency, eligible Wallet posting/effect
references, outstanding cash custody, active/claimed holds and entitlements,
promotion exposure, and registered pending provider operations. Missing actual
datasets or expected totals remain unavailable, not guessed empty populations.

After restore, obtain current authoritative Identity revocation/authVersion and
approved object/task/guest authority. Restored sessions, claims or cached grants
cannot resurrect access revoked after a snapshot. Keep recovery execution blocked
where current authority or its accepted restore protocol is unavailable. C remains
capacity authority; replay cannot rebuild capacity from a Billing success.

E and owners must accept a fresh restore/process incarnation fence before
resuming execution. A restored lease counter or row revision can repeat an old
token; surviving pre-restore workers must remain unable to finalize against the
restored state. Preserve permanent business/provider identities while invalidating
old execution authority, and prove this with the actual old worker.

Reconcile restored owner state against actual owner history/operation queries and
accepted broker checkpoints. Rebuild an authorized projection separately from
replaying a money command. Use permanent business-effect identity and original
provider operation correlation even across snapshots and queue redelivery.
Preserve later known postings and contradictory evidence for review; do not
truncate history, manufacture balancing credit or regard an earlier snapshot as
proof that a later registered operation never committed. Expected versus observed
totals, source completeness and unresolved exposure must be auditable before
claiming restore acceptance.

## Queued child sequence and required gates

These are proposed names for E agreement, not active branches or accepted scopes.
The missing full W07 providers and accepted BASE_W08 remain prerequisites; this
packet cannot replace them. Once authorized implementation starts, parent becomes
`INTEGRATION_PENDING` until all task-listed combined-source gates pass.

| Queued child | Narrow scope and prerequisite | Gate before its consumer may merge |
| --- | --- | --- |
| W08-E-ENTRY-AND-RESOURCES | E with B/C/D and policy/provider owners publishes immutable base, closed status/fence/authorization profiles, isolated resources, genuine datasets and budgets. | Accepted versions/source and actual allocation; preserved mandatory gates and eligible independent review. |
| W08-B-OWNER-INTEGRITY-PROVIDERS | B repairs actual defects within accepted Billing/Wallet/Subscription/Pricing/Catalog contracts; uses merged narrow C intent/fence provider where needed. | Real owned DB migrations/upgrade/runtime-role constraints, HTTP/current Identity, contention, uniqueness, event-version/fence and restart recovery; actual provider conformance for applicable external paths. |
| W08-C-CAPACITY-CONSUMER | C uses merged B recovery/status providers and actual Scheduling authority. | Real affected late-payment, cancellation, partial/unknown compensation and rebooking journeys before consumer merge; no fixture renamed full-flow evidence. |
| W08-D-OPERATIONAL-CONSUMER | D uses merged bounded B owner queries; E supplies accepted route/grant/alert infrastructure. | Real owner reads/current scope and revocation, safe fieldsets/private evidence, pending/discrepancy states, permitted repair outcomes and audit visibility. |
| W08-E-INTEGRATED-FAULT-PERFORMANCE | E serializes latest target plus child heads against actual approved datasets/budgets; A/B/C/D use real services. | Real DB races and process/DB/broker failure boundaries, auth/private proof/receipt gates, immutable journals and conserved funds/benefits/promotions/custody, independent C capacity and measured approved performance. |

All required business, recovery, provider, restore and performance gates are
**NOT_RUN** here. Source-path analysis and local models, if separately recorded,
cannot prove real DB contention, broker delivery, provider connectivity, alerts
or restore correctness. Missing required-provider acceptance remains explicit
full-launch `NO_GO`; no adversarial fixture closes it.
