# W06-B — Subscription lifecycle and Booking entitlement proposal

Status: **PROPOSED_NOT_ACCEPTED / NO IMPLEMENTATION / BUSINESS TESTS NOT_RUN**.
This document records review inputs for B Subscription, Billing, C Booking and
E publication. It supplies no accepted policy, wire release, migration or runtime.
Source observation: immutable main `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`.

## 1. Source reality and conditional inventory

- `services/subscription/prisma/schema.prisma` contains only `ServiceMarker`.
  Subscription domain, application and ports export nothing; its module declares
  `BUSINESS_READY=false`. The generic messaging adapter is not an activation handler.
- Booking has only `ServiceMarker`, empty application/ports and false business
  readiness. Its pure transition table does not implement authorization, capacity,
  durable saga, SQL concurrency or Subscription commands.
- `architecture/parallel-contract-release.json` publishes no `BASE_W06` or accepted
  Subscription business contract. Shared contracts/events are `0.0.2`; clients
  are `0.0.1` with an empty business export. Proposed inventory is not a release.
- F001 assigns Subscription its customer plans, renewal state and wash entitlement
  ownership in `cw_subscription`; Billing remains sole financial ledger owner.
- B-09 in `B/W01/POLICY_DECISIONS.md` leaves plan price, units, eligibility, expiry,
  consume trigger, cancel, freeze, renewal and refund policy open. B-03/B-05/B-06,
  B-08/B-12/B-15 supply other unresolved Money, lifetime, custody and privacy inputs.
- Customer wash plans remain required inventory pending exact approval. Customer
  funding/withdrawal and marketplace/provider products remain explicit conditional
  task scope requiring approved inventory, policy and provider acceptance. No such
  acceptance is observed; this proposal neither implements nor silently excludes them.
- Payroll, provider marketplace membership, automatic recurring debit and a new
  checkout method have no approval in current source. Renewal creates no Booking.

## 2. Immutable plan, purchase and activation facts

Each candidate purchase intent binds one verified beneficiary to an immutable
approved plan revision and stable business identity. The snapshot must record:

| Snapshot family | Owner authority to bind |
| --- | --- |
| Plan and benefit | Subscription plan/policy revision, benefit meaning, exact units and approved beneficiary/eligibility |
| Service coverage | Catalog package/add-on/category compatibility and immutable revisions |
| Purchase price | Pricing quote and price version, exact accepted Money, rounding/tax policy and quote validity |
| Term | Approved effective/expiry rule, timezone policy, renewal behavior and existing-reservation treatment |
| Adjustments | Approved cancellation, freeze/change, refund, rollover, proration and correction rules |
| Provenance | Accepted contract versions, current actor/purpose, operation and audit references |

An illustration in the admin reference does not approve Basic/Premium/Fleet
parameters, a price or a new customer screen. Missing policy fails closed rather
than defaulting to zero tax, a unit count, a term length or automatic renewal.

Purchase intent, financial eligibility and active entitlement are independent.
Candidate intent states distinguish pending, confirmed eligible allocation,
definitively failed/cancelled and reconciliation required. Proof, provider request
acceptance, pending verification and genuine but unallocated merchant receipt do
not activate benefits. Genuine receipt truth remains recorded independently.

Activation requires the actual immutable approved plan/intent/beneficiary binding
plus a policy-eligible Billing allocation and confirmed posting references.
Subscription applies one activation business effect in its own transaction with
term/entitlements, command receipt, audit and outbox. It does not write Billing
journals or use event arrival alone as financial authority.

Business uniqueness survives replay-cache cleanup: the same activation identity
and eligible allocation cannot create a second term or duplicate granted units
with another request key. Source-ref/hash conflicts require owner reconciliation.
Lost response after commit queries or replays the same authorized operation.
Server effective dates follow accepted policy; neither browser time nor delayed
delivery changes the original financial or activation timestamps.

## 3. Term and renewal lifecycle

Candidate term states are `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED` where approved,
`EXPIRED`, `CANCELLED` and `RECONCILIATION_REQUIRED`. Exact transitions and effective
times require B/product/C review; state labels here grant no operation.

Renewal is a separate operation and prospective term with its own plan snapshot,
financial intent, business identity and source evidence. Record pending, confirmed,
definitively failed and unknown renewal outcomes separately from the current term.
Failed renewal creates no new active term or units. Existing term treatment and any
grace period remain policy decisions; renewal failure must not overwrite an otherwise
valid current term. UNKNOWN renewal keeps its original operation for reconciliation.

Cancel requested, scheduled cancellation and effective cancellation differ from
financial refund requested, reserved, UNKNOWN and confirmed. Cancellation cannot
erase consumed service history or declare a refund. Freeze/pause, resume and change
remain conditional lifecycle requirements: approval must settle permitted actors,
effective date, extension limits, price/benefit differences, live reservations and
compensation. No immediate freeze, plan swap or proportional adjustment is assumed.

Rollover and proration need approved exact rules and immutable original/new term
references. They cannot be inferred from elapsed days, remaining displayed units
or a refund amount. Rebooking and renewal obtain current Catalog/Pricing/C capacity
acceptance under the approved flow; neither automatically debits or books a slot.

## 4. Atomic availability, reservations and expiry

Subscription owns benefit availability and its constraints in its own database.
Conceptually, available units derive from granted units plus approved applied
adjustments minus consumed units and live reserved units, partitioned by immutable
benefit and term. Counts are exact bounded integers under an accepted policy;
unavailable/gapped views return unknown/null rather than fabricated zero/full units.

Reserve validates current beneficiary/object authority, term state and deadline,
compatible benefit/Booking intent, exact units and expected owner revisions in the
same SQL transaction as the reservation, business receipt, audit and outbox.
Two competing requests for the final unit permit one accepted reservation/effect.
An optimistic read or frontend decrement does not enforce this invariant.

Persist original reservation expiry and stable Booking/business operation binding.
Same-key/exact-body replay retains original expiry; changing a key cannot renew it.
Benefit term expiry, entitlement reservation expiry, Wallet hold expiry and C
Scheduling capacity expiry are independent facts. Publish exact UTC boundary,
clock/skew authority and consume eligibility instead of adopting a guessed TTL.

Expiry, consume and release serialize on current reservation state/revision/fence.
One terminal outcome wins; duplicate/stale release never recreates consumed units.
Release of an expired term's reservation does not restore usable expired benefits.
Late financial confirmation or a replay cannot resurrect expired capacity or a
cancelled Booking. Any approved new Booking requires a new current assessment.

## 5. Consume authority, UNKNOWN and correction

Consume binds the same beneficiary, Booking, reservation, policy and actual
operational prerequisite at the approved trigger. Reserve is not payment, consume
or capacity. C cannot decrement Subscription locally or nominate arbitrary units.

Where the accepted consume protocol requires a Billing or other external effect,
Subscription first claims a durable command-bound consume authority/fence. A cached
reservation read and expected revision alone cannot close an expiry/consume race.
If that effect may have committed, timeout/disconnection is UNKNOWN: keep the
claimed partition unavailable, reconcile the same operation, and only then resolve
consume/release/expiry under accepted authority. No timer restores units while the
same pending financial/operational effect could still succeed.

Release closes an unconsumed reservation; it does not undo consumption or refund
money. Consumed outcomes require an approved immutable linked correction with
original activation/reservation/effect references and actual Billing reversal
references where required. Refund and benefit adjustment are separate operations.
Pending/UNKNOWN refund never restores units optimistically. An applied correction
has actual exact restored/removed counts, current audit/effect and policy authority;
history remains intact. Partial use and active reservations require explicit rules.

## 6. C coordination and safe consumer states

C Booking owns durable intent, resource orchestration and compensation. Persist
each step identity before calling real B reserve/consume/release providers. B/C/E
must approve acquisition/commit order and recovery for every failure. Release only
still-unconsumed reservations and separately release C capacity/approved Wallet
holds. Consumed effects require B correction; no peer DB rollback or negative counter.

| Owner facts | Candidate A/C/D interpretation |
| --- | --- |
| Purchase pending or UNKNOWN | A activation pending; C no usable new entitlement; D separate financial/benefit recovery facts |
| Genuine receipt unallocated/mismatched | No active term, inferred paid Booking or usable units; preserve financial review truth |
| Last unit reserved for Booking X | Exact owned available/reserved counts; concurrent Y cannot consume X's reservation |
| Consume committed, Booking response lost | Reconcile same operation; retain consumed fact and independent Booking pending outcome |
| Cancel confirmed, refund UNKNOWN, correction pending | Original receipt/service history retained; no refund success, restored units or revived capacity |
| Renewal definitively failed | No activated new term; existing term follows its own approved expiry/cancellation rules |
| Source gap or stale projection | Honest checkpoint/freshness/unknown counts and assigned owner reconciliation |

## 7. Compatibility and unexecuted acceptance

Preserve closed W01 candidate `EntitlementReserveCommand` and
`EntitlementResolveCommand` and W05 B/C packet semantics. New beneficiary, snapshot,
expiry, operation and authority fields require E-reviewed compatible contracts or
new majors. W05 B reservation sample omits explicit `EXPIRED`; request that state
and its semantics explicitly, never silently widen existing readers. Current
Identity grants, generic adapters and F001 event names are not new operation authority.

All lifecycle acceptance remains **NOT_RUN**: real DB final-unit/expiry-consume/
release races, duplicate activation, Billing-commit restart recovery, current denied
guest/member/admin scope, missing/duplicate/gapped events, failed renewal, approved
partial refund/rollover/proration and real serialized C purchase→Booking→consume→
cancel/release journeys. Actual merged producers and combined final-source evidence
must precede consumer acceptance; pure helpers, fixtures and foundation CI do not close it.
