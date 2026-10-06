# W07-B — Rebooking, Subscription adjustments and refund routing

Status: **PROPOSED_NOT_ACCEPTED / IMPLEMENTATION_BLOCKED / BUSINESS_TESTS_NOT_RUN**.
Observed target: `f01e87f4619414960e9e39c65e523a3250fbcbaf`, tree
`2266f157ad2480855011d5da59e00e5b0cf1f68f`. This is the current proposal
source, not an E-published BASE_W07. Billing, Wallet, Subscription, Pricing and
Booking remain foundation shells; their existing ServiceMarker tables and empty
application exports do not implement these operations. The merged W06 proposals
remain unaccepted behavior. This document changes no runtime, schema, migration,
accepted contract, application or commercial policy.

## Source continuity and ownership

Read this proposal with [W06 Subscription lifecycle](../W06/SUBSCRIPTION_LIFECYCLE.md),
[W06 Wallet recovery](../W06/WALLET_AND_POSTING_RECOVERY.md),
[W05 refund recovery](../W05/VERIFICATION_REFUND_RECOVERY.md),
[W03 Billing design](../W03/BILLING_DESIGN.md) and
[W01 open policies](../W01/POLICY_DECISIONS.md).
Current [C requests](../../C/W06/W07_CONTRACT_REQUESTS.md) require separate
refund, benefit-correction and promotion-restoration receipts; current
[D requests](../../D/W06/W07_CONTRACT_REQUESTS.md) require owner APIs and truthful
remedy status. [E scope gaps](../../E/W06/W07_SCOPE_GAPS.md) retain the missing
actual predecessor providers and combined journeys as blockers.

| Fact | Authoritative owner | Consumer boundary |
| --- | --- | --- |
| Service definitions and compatibility | B Catalog | Current published revisions, not a price or capacity grant |
| Quote, monetary promotion and redemption capacity | B Pricing | Server calculation and independent reservation/redemption/restoration facts |
| New Booking intent and durable compensation | C Booking | Original/new intent linkage and lifecycle fence; no B or Scheduling table access |
| Current capacity and its reservation/expiry | C Scheduling | A financial outcome cannot grant or revive a slot |
| Verified funds, refund allowance and immutable postings | B Billing | Sole financial ledger; Subscription and Wallet consume public evidence |
| Approved holder/purpose backing, holds and movements | B Wallet | Posting-backed owner facts; no second ledger or fourth payment method |
| Plan, term, benefit units and their corrections | B Subscription | Consumption history persists; units are not cash |
| Administrative remedy request and reporting projection | D Support/Reporting | A case decision cannot itself refund, restore benefits or publish source truth |

No payroll, marketplace/provider membership, recurring debit, customer funding or
withdrawal product is inferred from these service names. Applicable approved
inventory must still be resolved explicitly; customer wash-plan refund and
adjustment requirements remain full-launch obligations.

## Rebooking obtains a new current assessment

The old Booking, quote, receipt, plan/use and promotion snapshots remain immutable.
Rebooking may recover editable customer choices under current authorization; it
does not transfer old financial or resource authority. Preserve the approved
seven-screen journey, guest cash and optional plate. A new quote or recovered
draft cannot create a Booking without the actual C transition and explicit
customer acceptance required by the approved flow.

Propose this owner sequence for E/C/A/B review; acquisition and commit order are
not an accepted implementation:

1. C creates a narrow new intent with stable rebooking identity, authorized
   subject or accepted guest capability, original Booking reference, current
   lifecycle revision/fence and permitted choices. Replaying the old intent is
   recovery of that operation; making a replacement intent is a distinct action.
2. Read actual current Catalog compatibility, A-owned vehicle/location authority,
   C-owned availability inputs and Subscription eligibility using public
   accepted contracts. Read-only eligibility and displayed availability reserve
   nothing. Historical address, benefit or work facts grant no current authority.
3. Pricing issues a new immutable quote with current price, Catalog and monetary
   policy revisions, exact item/fee/tax/discount breakdown, authorized beneficiary,
   approved benefit/promotion mixing and server validity. Expired promotions or
   prices are assessed using current policy. Do not copy the old amount or reuse
   an old benefit/promotion effect in the calculation.
4. C persists separate new capacity, Subscription reservation, approved Wallet
   hold, Pricing promotion reservation and Billing operation identities before
   dispatch. Acquire only resources required by the approved tender/benefit mix;
   an entitlement purchase is not a capacity hold. Each owner validates the same
   intent, quote/policy binding, beneficiary, exact requested effect and current
   revision/fence under its own real transaction. Any expiry-sensitive external
   effect requires durable execution authority, not a cached eligibility read.
5. Execute the accepted commitment protocol. Billing money, Subscription use,
   Pricing redemption, Wallet resolution and C confirmation remain independently
   queryable. A partial commit records durable recovery; it does not authorize a
   frontend to show completed Booking or to retry with new money identities.
6. If acquisition or commitment fails, C compensates each acquired resource
   through its owner. Release only eligible uncommitted resources. Consumed money,
   benefits or promotions require separately approved linked correction/refund/
   restoration effects. New capacity after an expiry requires a new Scheduling
   acceptance; a late financial result cannot revive it.

Price or item changes require the approved current customer acceptance behavior.
Whether a still-valid original quote is honoured for its original Booking is
B-05 policy; it never grants automatic reuse for a new rebooking. Quote issuance,
capacity search and benefit eligibility are separate from reservation/commitment.
If any required authority or source coverage is stale or unknown, expose that
condition and stop the dependent commit rather than reconstructing it locally.

| Historical resource | Required rebooking treatment |
| --- | --- |
| Expired/revoked quote or retired source version | New eligible quote; preserve old snapshot and original validity/disposition |
| Consumed entitlement | Retain consumption; request a new eligible reservation or actual approved linked correction first |
| Captured/consumed Wallet hold | Retain posting-backed outcome; any permitted new funding/hold must have new approved backing |
| Redeemed promotion | Retain redemption; no implicit reuse, capacity increment or duplicate restoration |
| Released but now-expired term/promotion | Release records history; it does not make expired value usable |
| UNKNOWN owner command | Query/reconcile that same operation; no replacement charge, unit claim or redemption |

## Refund eligibility is server verified and fenced against use

A plan refund request names the actual purchase, term/plan snapshot, beneficiary,
original eligible Billing allocation/postings, reason, requested Money, policy
revision, expected owner revisions and any required independently approved remedy.
The request body, unused-unit display, proof image or Support case closure is not
financial evidence. Billing verifies original confirmed receipts/allocation and
current authorized refund scope. Subscription independently verifies actual
consumption, active reservations, term state and approved adjustment rules.

The business/accounting owner must approve unused/partly used/fully used plans,
fees, taxes, reversals/disputes, refund destination, expiry, freeze, cancellation,
renewal failure, change/rollover and proration. No daily proportional formula,
remaining-unit value, zero fee, full unused-plan refund or fixed cutoff is assumed.
Policy approval requires immutable effective revision, approved actors and exact
rounding/accounting effects. Missing B-03/B-04/B-06/B-08/B-09 prevents execution.

Propose a narrow Subscription adjustment eligibility/claim provider before
Billing consumes the refundable assessment. In its own transaction it binds the
plan/usage snapshot and stable adjustment operation, records the approved impact
on concurrent reservation/consume/expiry/change, and provides durable authority
for the particular financial operation. A read followed later by a refund is
insufficient: a concurrent consume could invalidate that read. The accepted
protocol must decide which affected units are claimed/frozen, whether an existing
reservation wins and how expiry interacts with correction. Do not suspend an
entire plan by default or guess usable residual units.

Once a financial effect might have executed, the claim remains accountable and
unavailable to contradictory use until the same financial operation is resolved.
Revocation, worker/authority expiry, lost reply or absent lookup does not prove
noncommit. Release requires an accepted definitive no-effect result and a fence
that prevents a late worker from committing. If no safe joint eligibility/fencing
protocol is accepted, the refund/use race is a full-launch blocker, not an
administrative override. Owner-local transactions are not a cross-database commit.

### Partial and full refund ceiling

For each accepted original payment/allocation/currency scope, Billing atomically
enforces the approved cumulative refundable cap:

`confirmed refund amounts + unresolved reserved/in-flight/UNKNOWN amounts <= approved cap <= eligible original confirmed funds`.

Confirmed outcomes and unresolved allowance reservations are disjoint; a refund
confirmation consumes its reservation in the same transaction so the amount is
not counted twice. Each amount uses the same accepted exact Money/currency policy.
A plan spanning multiple receipts/allocations needs explicit allocation of the
requested amount and both per-source and aggregate purchase bounds; callers
cannot refund an allocation twice by targeting its payment or plan differently.
The approved cap is derived from actual source evidence and frozen eligibility,
not requested totals. Changes after an external attempt need approved correction
or reconciliation; they cannot erase already confirmed or UNKNOWN exposure.

Persist refund business identity, allowance reservation, current approval and
stable provider attempt before external execution. Different request keys,
different administrator sessions and retries after cache cleanup cannot bypass
the business uniqueness or cumulative ceiling. An approved full refund competes
with approved partial refunds under the same owner constraints; one cannot use a
fresh endpoint or key to reserve the already exposed residual again.

Provider submission acceptance, timeout, disconnect and ambiguous status remain
pending/UNKNOWN. Keep allowance reserved and recover the original operation under
the real accepted provider protocol. Definitive failure needs documented finality
and terminal execution fencing. Confirmed returned funds need independently
verified provider/bank evidence or actual authorized cash-delivery evidence.
Billing commits the linked immutable reversal/correction, actual receipt, consumed
allowance, audit and Outbox once. Original receipt/postings remain unchanged.

## Plan change, benefit correction and promotion restoration are separate

| Operation | Required actual outcome | Prohibited inference |
| --- | --- | --- |
| Monetary refund | Billing confirmed returned Money and immutable linked posting refs | Refund requested/approved means funds returned |
| Unconsumed benefit release | Subscription closes that reservation under accepted state/fence | Release reverses consumed service history |
| Entitlement reversal/adjustment | Subscription applies approved exact unit delta with original activation/use/reservation and correction refs | Confirmed refund alone recreates units or cancels all reservations |
| Promotion release/restoration | Pricing applies approved reservation disposition or linked redemption correction within its own constraints | Cancellation/refund restores every use, budget or guest/customer allowance |
| Plan change/proration | New immutable approved plan/term adjustment, exact effective rule and separate financial/benefit effects | Rewriting old plan, receipt or consumed units produces a lawful adjustment |

Persist one adjustment identity per approved original effect/action/policy domain
and retain it beyond replay-cache lifetime. A monetary refund may reference
several approved corrections; each owner applies its own effect once. Correction
limits also aggregate across distinct keys: repeated partial refunds cannot
restore more benefit units or promotion capacity than the approved original
eligible effect. Corrections remain traceable even if they grant no usable value
because the original term or promotion has expired.

Plan change uses current authorized Catalog/Pricing/Subscription snapshots and
explicit effective-date/proration policy. Link old/new versions, purchase/term,
used and reserved history, new obligation or refund and approved customer consent.
Do not overwrite old unit grants or silently move live reservations. Additional
payment pending/UNKNOWN does not activate extra units; refund pending/UNKNOWN
does not return units or promotion budget. Failed renewal preserves the prior
term's independent status under its own policy; no automatic debit is introduced.

Cancellation races serialize on each owner's revision and terminal fence. A stale
release after consume must return its real consumed/conflicting outcome rather
than add units. A delayed restoration request requires the approved original
effect and stable correction identity; it cannot transfer restored capacity into
a new promotion/version unless the explicit policy allows that effect. C tracks
all compensation child results and exposes unresolved/review states independently.

## Wallet refund routing requires approved destination authority

Billing chooses only the explicitly approved refund route for original funds and
current beneficiary/payer/holder/purpose. An arbitrary account ID, a team custody
balance or Subscription units cannot redirect a customer refund. Wallet validates
the actual confirmed Billing reversal/refund posting, approved source-to-destination
mapping, exact currency/policy and current object/purpose authority through public
contracts. Apply one posting-backed movement and checkpoint; retain discrepancy if
source evidence is missing or contradictory. Pending refunds are not spendable
Wallet credits. Original provider/cash refund and Wallet movement must not return
the same value twice.

The W01 closed proposed `wallet.hold-resolve.v1` command requires nonempty, unique
`billingPostingIds` for **both CONSUME and RELEASE**. Its source is
`docs/parallel/B/W01/future-finance-contracts.schema.json`,
`$defs.WalletHoldResolveCommand`. Preserve that contract's shape; C's proposed
optional outcome references do not relax it. No empty references or fictional
posting may satisfy a no-financial-effect release. Such release/expiry requires a
separate accepted family or action-discriminated new major with real terminal
authority, operation, Booking/policy/fence and compatibility semantics.

Wallet capture claimed for a pending/UNKNOWN Billing effect remains unavailable
after hold/authority/worker expiry. Billing commit followed by lost reply/restart
resolves the same claim from its actual posting once. Release is allowed only
after definitive noncommit with late execution fenced. A subsequent approved
refund references the committed original and actual linked posting; it does not
reopen the consumed hold or manufacture new backing.

## Proposed publication profile and safe status mapping

Candidate semantic families are `booking.rebook-intent`, `pricing.requote-bind`,
`subscription.adjustment-claim/status/resolve`, `billing.refund-reserve/status/resolve`,
`wallet.refund-apply/status` and `pricing.promotion-restoration/status`.
These names are review inputs, not released IDs, routes, parsers or events.
E must publish exact versions and closed schema variants with producer/consumer
approval at the common base. Preserve existing closed draft shapes and strict
`booking.confirmed.v1`; incompatible additions require reviewed new majors rather
than widening readers or copying private DTOs.

| Profile field | Required accepted meaning |
| --- | --- |
| Authority | Server actor/current authVersion, subject or bound guest, delegation, object/action/purpose/market and approved service recovery authority checked at command, execution, status and replay |
| Identity/revision | Owner-scoped intent/operation/quote/plan/term/usage/reservation/allocation/posting/correction IDs, original/new links, current expected revisions and durable lifecycle/execution fences; no cross-owner revision ordering |
| Money/units | Canonical exact integer-minor string candidate plus currency/policy revision, approved exponent/bounds/rounding; exact bounded signed correction units as approved; no float or implicit conversion |
| Time | Server UTC effective/expiry/observed/as-of instants with approved market timezone; clock authority and exact boundary rules; financial, term, promotion and capacity deadlines independent |
| Replay | Owner + operation major + current actor/delegation + business target scope; canonical fingerprint covers all immutable meaning, ordered/set semantics, refs, reason/policy/approval/fence and exact Money/units |
| Results | Stable authorized operation receipt; required/null/absent distinctions, independent owner outcome/revision, actual effects and refs, source coverage and safe unresolved reason; acknowledgment is not completion |
| Delivery | Local state/effect/receipt/audit/Outbox commit together; Inbox ID/hash/local effect/checkpoint before ACK; conflict quarantine, old/gap/reorder repair and no event-driven duplicate money |
| Lifetimes | Approved key replay and business tombstone retention, claim/term/promotion deadlines, transport deadlines, retry/reconciliation/escalation limits and status-history coverage; no invented numerical default |

Same key and meaning replays the original authorized receipt and original deadline;
changed meaning conflicts. A concurrent unresolved command returns its actual
queryable operation, not assumed success. Business-effect uniqueness survives
command-cache retention. Transient credentials, signed URLs and transport tracing
are excluded from the business fingerprint; changing them grants no new effect.
An event source gap yields unavailable/stale/partial
coverage and nullable affected totals; it cannot become fabricated zero or full
availability. Events carry minimal effect/source/revision/correction references
and approved amounts/units, never proof bytes, contacts, plate or provider secrets.

Candidate error classes for A/C/D/E to freeze are `AUTH_REQUIRED`,
`AUTHORIZATION_DENIED`, `RESOURCE_NOT_FOUND` under an approved non-disclosure rule,
`INVALID_INPUT`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INELIGIBLE`,
`POLICY_UNAVAILABLE`, `QUOTE_EXPIRED`, `SOURCE_UNAVAILABLE`, `OPERATION_PENDING`,
`OUTCOME_UNKNOWN` and `RECONCILIATION_REQUIRED`. Exact codes, HTTP mappings,
retryability and translated copy remain unaccepted. A network error with a
possibly executed command maps to operation lookup/recovery, never definitive
rejection or automatic fresh-key retry.

| Actual owner facts | Required A/C/D interpretation |
| --- | --- |
| Requote issued; resources not yet accepted | A shows current proposal only; C not confirmed; D old/new facts separate |
| Price/eligibility changed or quote expired | Obtain current assessment and approved acceptance; preserve original history |
| Refund reserved or UNKNOWN; benefit correction undecided | A refund pending; C compensation unresolved; D separate money/unit/promotion statuses |
| Refund confirmed; correction/restoration still pending or denied | Report actual returned funds only; no restored benefits or available promotion implied |
| Benefit adjustment applied; refund not confirmed | Report actual exact benefit effect; no returned-money claim |
| Wallet claimed; Billing may have committed | Claim stays unavailable; reconcile original operation and posting, no expiry credit |
| Correction completed after original term/promotion expiry | Preserve correction and current unusable/expired state as policy requires |
| Revoked actor or incomplete source coverage | Deny current access or show approved unavailable/review state; no stale privileged replay |

Production Arabic/English labels and missing loading/denial/recovery states require
the exact A/C/D/product acceptance. This proposal does not modify approved copy.

## Required real acceptance and dependency order

Every case below is **NOT_RUN**. No new business implementation, allocated real
finance database, provider environment, broker business consumer or three-app
journey exists in this packet. These are acceptance requirements, not runnable
test results. E must allocate isolated databases/roles/queues/ports and approve the
exact commands before execution; schema fixtures and pure helpers cannot close them.

| ID | Required real SQL, HTTP, crash or combined-journey case |
| --- | --- |
| RA-01 | Price changes/retirement between old Booking and new rebook: new quote/current item compatibility, explicit current acceptance, immutable old quote/receipt and no reused expired capacity |
| RA-02 | Rebook with a spent unit, consumed Wallet hold and redeemed promotion: each requires new actual eligible authority; no copied effects or automatic restoration |
| RA-03 | Mixed benefit and promotion under approved stacking: eligible covered units and residual exact Money counted once, actual new reservations, failure compensation and no double discount |
| RA-04 | Same guest/customer new-intent and revoked/foreign subject races: real current owner authorization at quote, reserve, execution and replay; optional plate/phone cannot identify finance ownership |
| RA-05 | Two last-unit consumes versus partial/full refund/plan change/expiry: actual Subscription claim/fence gives one policy-valid result; Billing cannot execute on a stale eligibility read |
| RA-06 | Concurrent distinct-key partial and full refunds from one and multiple original allocations: actual cumulative source/purchase ceiling; cross-endpoint/key/session attempts cannot exceed cap |
| RA-07 | Provider timeout, absent lookup, crash before send/after send/before local confirmation and definitive failure: UNKNOWN retains original allowance/claims; terminal closure prevents late duplicate execution |
| RA-08 | Billing confirmed refund then lost response/restart/duplicate changed-event ID: immutable original and linked posting, exactly one Wallet effect and exact once owner correction; conflicting evidence quarantined |
| RA-09 | Cancel/consume/release/restoration race and stale worker after definitive no-effect fence: consumed history stays; no double benefit, promotion use/budget or spendable backing restored |
| RA-10 | Pending/confirmed refund independently combined with denied/partial/applied unit and promotion adjustments: truthful A/C/D status, exact unit/restoration caps and no refund-implies-revival |
| RA-11 | Partly used term, live reservation, approved plan-change effective boundary/rounding and failed renewal: old consumption retained, approved residual handling and independent prior term |
| RA-12 | Wrong currency, unverified/mismatched allocation, foreign holder/purpose, arbitrary Wallet destination and unsupported policy: denied before effects; actual allowed route positive control |
| RA-13 | Hold expiry/revocation during UNKNOWN capture/refund, Billing commit before Wallet update, duplicate source/correction and gapped events: durable unavailable claims and original-operation convergence |
| RA-14 | Runtime raw SQL journal update/delete, unbalanced concurrent posting, invalid accounts and reprovisioning replay: ledger integrity/immutability and privileges remain enforced; migrations upgrade an existing schema without reset |
| RA-15 | Real broker publish/commit/ACK crashes, hash conflict, correction before original, out-of-order revisions and source repair: one owner effect, honest incomplete coverage, no funds/capacity revival |
| RA-16 | Serialized actual customer/operator/admin cash and each required electronic route, Wallet, Subscription renew/use/partial-full refund, promo/rebook and reconciliation journey against merged producers with genuine approved provider evidence |

E must review these named children and their exact gates before implementation:

First resolve missing predecessor cycles: split the W06 C narrow intent/lifecycle
fence provider from the full B-consuming Booking saga and accept its actual
DB/HTTP/Identity/constraint gate independently. B can then accept the W06 posting,
Wallet and Subscription providers against that merged binding; the full W06 C
saga and affected consumers follow those real providers. No predecessor child
requires its future consumer journey to exist, and no W07 child accepts the
missing W06 combined-source barrier by relabeling it as a new proposal.

1. **W07-C-INTENT-FENCE**: narrow current rebooking/cancellation intent, revision,
   authorization, status and terminal-fence provider, without the final B saga.
   Accept real C DB/migrations/HTTP/Identity/constraint tests first. Required
   predecessor Scheduling, Identity/guest and W06 B providers must already exist.
2. **W07-B-ADJUSTMENT-AUTHORITY** and **W07-B-PROMOTION-PRICE-PROVIDERS**: independently
   scoped Subscription adjustment claim/eligibility and Pricing current quote/
   promotion authority, against merged C binding and real accepted predecessors.
   Accept current scoped HTTP, real local SQL races, migrations and closed public
   conformance without requiring a future unmerged app journey.
3. **W07-B-REFUND-RESOLUTION**: Billing original-source/cumulative cap/execution
   provider and Wallet/Subscription/Pricing actual linked resolution against the
   now-merged authority providers. Prove genuine provider protocol, durable UNKNOWN,
   immutability and crash/race/reconciliation gates. Separate no-effect Wallet
   release compatibility must be accepted before that path executes.
4. **W07-C-REBOOK-COMPENSATION**, then **W07-A-C-D-FINANCE-CONSUMERS**: C consumes
   merged actual owner APIs; A/C/D implement the full affected production journeys
   and E serializes the three-app matrix before consumer/integration merge.

These names queue reviewable dependencies; this proposal starts none of them and
does not create new branches/PRs or accept a release. Parent remains NOT_STARTED
while BASE_W07/entry is absent, then INTEGRATION_PENDING once actual authorized
implementation begins until all required combined-source cases pass. No fixture,
old head's CI, document merge or same-account review closes a provider, consumer
or full-launch gate.
