# W06-B — W07 finance contract requests

Status: **PROPOSED_NOT_ACCEPTED / NO W07 IMPLEMENTATION / TESTS_NOT_RUN**.
Candidate request packet `w06-b-w07-finance-governance/0.1.0`; V1/new-major
labels are owner-review requests, not published schemas or package versions.
No BASE_W06/BASE_W07, grant, policy, provider capability or permission to start
another wave follows from this document. W06 privacy fulfillment remains required
in [the current proposal](PRIVACY_FULFILLMENT.md); W07 covers compatible extensions.

## Common profile required for every request card

Owners/E must close this profile for each concrete command/read/event, with the
card-specific semantics below. Unknown policies fail closed; no timer, monetary
conversion, production rate, approval threshold or legal rule is guessed.

| Profile dimension | Explicit publication request |
| --- | --- |
| Authority and schema | Authoritative producer, actual consumers, contract ID and supported major; exact route/event variants, parser/client exports, bounded required/nullable fields, enums and unknown-field/major behavior. Names below are candidates. |
| Current authorization | Verified subject/session/authVersion, role and action/object/market/purpose scope, service audience/delegation and beneficiary binding; accepted guest expiry/recovery/claim and CSRF/Origin where applicable. Recheck current authority on sensitive command/read/replay/download. |
| Identity and revisions | Stable owner-scoped resource, operation and business IDs; independent expected/current owner revisions, policy/catalog/price/Booking/posting/benefit references and revision fences. No invented global revision or body-supplied owner. |
| Money and time | Exact bounded minor-unit strings/currency/exponent/policy and approved rounding/tax/fees; no floats/default rate or cross-currency addition. Canonical UTC/effective times, accepted market timezone and explicit boundary/skew/deadline rules. |
| Transition and receipt | Allowed prior/next states, one-winner constraints and action-specific required/null evidence; durable immutable operation/result/audit with actual accepted/completed times and pending phase. Read freshness is separate from mutation authority. |
| Key and fingerprint | Accepted ingress key syntax and actor/service+owner+operation+target+business identity scope. Canonical meaningful payload includes beneficiary, exact Money/units, purpose, policy, refs/revisions, effective time, reason and selected fieldset. Define array/set ordering and exclude secrets/transport IDs. |
| Replay and lifetimes | Same key/meaning recovers original receipt/IDs/expiry after current auth; changed meaning conflicts; concurrent pending resolves one operation. Permanent business-effect uniqueness survives cache cleanup. Publish exact key/replay/tombstone/lease/hold/grant/cursor/retention lifetimes. |
| Errors and UNKNOWN | Closed safe codes for malformed, revoked/foreign, stale/conflicting, unsupported policy/schema, ineligible, amount/currency mismatch, dependency unavailable, partial and unknown outcome. Freeze HTTP mapping, bounded deadlines, safe phase/operation/next action and authorized lookup/retry owner. |
| Compensation and delivery | Owner state/receipt/audit/outbox atomicity; authenticated event producer and owner revisions; consumer Inbox/hash/effect/checkpoint before ACK. Explicit duplicate/hash-conflict/stale/gap/rebuild behavior and stable compensation identity. No cross-DB rollback or exactly-once assumption. |
| Compatibility | Old/new readers, closed nullable transitions, supported majors/enums, event history/replay and migration/upgrade/rollback evidence. Breaking semantics need a reviewed major/adapter and accepted base; preserve existing strict Identity/booking.confirmed.v1. |
| Provider/consumer gates | Real owned DB/HTTP/current Identity/migration/constraints and crash/restart/security proof before actual C/A/D consumers and serialized journeys. A mock/schema/example cannot close a producer gate. Record immutable source/tree/versions/resources/results. |
| E publication/configuration | Exact contracts/event-contracts/api-clients release, OpenAPI/AsyncAPI registry, Gateway routes/headers/cursors, scoped actor/service grants, broker bindings/ACL/DLQ/replay, technical dependencies, DB runtime/migrator roles, ports/storage/scanner/isolated resources and mandatory commands. All shared manifests/locks/config/CI/infra remain E-owned. |

Current packages are foundation contracts/event-contracts 0.0.2 and api-clients
0.0.1 with empty business exports. Current Identity permissions do not publish
Pricing governance, promotion, Subscription adjustment or finance privacy grants.
Current Gateway owner vocabulary lacks Pricing/Wallet/Subscription/Media.
Every requested extension therefore needs E/provider/consumer review and release.

## CR-B07-01 — Pricing administrative lifecycle

Authority: B Pricing owns price versions/quotes/promotions; D admin consumes the
real provider. Request new closed create/amend-draft, submit/review, approve/reject,
publish, retire/supersede, schedule-effective and operation/history families.

Freeze version/draft/review/publication/operation IDs and independent revisions,
reviewed content hash, Catalog applicability refs, exact Money and financial
policy refs, approved effective UTC/market interpretation, reason and actor audit.
Review must bind the actual reviewed content. Changing a draft after review
requires the accepted re-review rule. Published versions/history are immutable;
correction publishes a new version rather than editing prior rates or receipts.

Request current author/reviewer/publisher/retirement/schedule grants, action scopes
and approved separation/limits. Existing billing.refund does not grant publication.
Same command recovers one publication; changed effective/content/policy conflicts.
Scheduled activation needs durable job/lease fencing, restart recovery and an
approved overlap/tie rule for each applicable rate dimension. Retirement preserves
historical resolution. Cancelling a schedule needs its own accepted transition.

Required tests: current/foreign/revoked grants; publish/review/amend races; price
dimension and effective-interval constraints; boundary/skew/restart activation;
same/different fingerprint; response loss; upgrade/history; actual D admin flows.

## CR-B07-02 — Catalog boundary and quote honoring

Authority: B Catalog owns definitions/add-ons/descriptions/durations/compatibility;
B Pricing owns monetary rates/promotions/expiring quotes. F001 service catalog
controls this boundary; historical Catalog README/helper locations do not move it.

Request Catalog create/review/publish/retire/history with definition/description/
applicability revisions and approved immutable production content. Request Pricing
quote issue/read/history and eligibility evaluation tied to actual Catalog/price/
policy revisions, exact server calculation, subject/guest scope and original expiry.
Freeze current grants and publication audit separately for the two domain owners.

Resolve B-03/04/05: currencies/exponents/rates/tax/rounding, quote TTL/honoring,
revocation and retirement effects. A future price or Catalog retirement cannot
silently rewrite an accepted quote/Booking snapshot or posted amount. Same-key
quote recovery retains original identity/expiry; a fresh rebooking obtains a new
quote under current inputs. Unavailable policy returns safe unavailable, not zero.

Required tests: retired/incompatible inputs, old quote honoring/revocation under
the accepted policy, scheduled price boundary, historical descriptions, changed
request conflict, foreign guest and actual A/C/D quote/admin consumers.

## CR-B07-03 — Promotion limits and redemption

Authority: B Pricing with C Booking orchestration, approved D policy inputs and
A/D consumers. Request publish/review/retire, eligibility, reserve, commit/redeem,
release/expiry, adjustment and status/history closed families.

Freeze promotion/policy/version/budget/operation/reservation/redemption IDs,
subject/Booking/quote refs and independent revisions, exact discount Money or
approved percentage basis/rounding, applicability, stacking and exclusion rules,
market timezone/effective dates, total/per-subject uses and monetary budget.
Resolve B-10 reservation/redemption trigger, expiry, cancellation/refund reuse,
budget restoration and approved author/reviewer/action limits before execution.

Enforce final-use and budget limits atomically; quote calculation alone is not
redemption. Permanent Booking/promotion effect identity prevents cross-key reuse.
UNKNOWN commit retains unresolved reservation/budget exposure until authoritative
lookup resolves it. Release cannot undo an already committed redemption without
an approved linked adjustment; no timer or retry creates additional eligibility.

Required tests: competing last use/budget, stacking and currency bounds, same-key
response loss, cross-key duplicates, commit/expiry/cancel races, restart/event gaps,
approved restoration and actual C Booking plus A/D recovery rendering.

## CR-B07-04 — Rebooking and financial amendment

Authority: C Booking owns durable orchestration/capacity lifecycle; B Pricing,
Billing and Subscription provide financial/benefit facts. Request new quote,
amendment eligibility/reserve/commit/status, benefit replacement and compensation
families; consume actual Scheduling/Booking bindings, not private C DTOs or tables.

Freeze original/replacement Booking and saga IDs/revisions/fences, old/new quote
snapshots, capacity and benefit reservations, financial-plan/amendment/business
IDs, exact additional/refundable Money, policy/effective times and customer consent
where required. Resolve cutoffs, started-work safety, fees, refund/difference and
old-quote honoring explicitly; rebooking does not copy stale pricing or grants.

C records each independent owner result/deadline. Old/new capacity, benefit and
financial outcomes remain distinguishable during partial failure. UNKNOWN money
uses original operation lookup and retained exposure; no new-key charge/refund.
Compensation releases only eligible uncommitted holds; committed money/work and
consumed units require approved linked adjustments, never silent resurrection.

Required tests: unavailable replacement capacity, last-benefit contention, price
change, amendment/cancel/start races, lost response and restart at each owner
commit, partial compensation, and serialized real A/C/D rebooking journeys.

## CR-B07-05 — Subscription refund and adjustment

Authority: B Subscription owns entitlements; Billing owns all monetary postings/
refund execution; C supplies actual Booking reservations/use, D Support/admin
requests approved remedies. Request adjustment eligibility/proposal/decision,
reserve/commit/release/status/history and linked Billing refund families.

Freeze subscription/plan/purchase/financial-event/entitlement/use/reservation/
Booking/operation/posting IDs and revisions, approved units and exact Money,
policy/snapshot/effective date, reason/evidence and independent approval refs.
Resolve B-06/09 unused/consumed units, rollover, proration, expiry, renewal failure,
freeze/resume/change, refundable cap and customer versus provider inventory.
No new plan, automatic debit or guessed prorated refund is approved here.

Competing use/refund/expiry must have one owner-authorized result; active/UNKNOWN
reservations cannot be made available by an admin balance edit. Billing retains
reserved/inflight/UNKNOWN refund allowance. Entitlement change, refund accepted
and confirmed returned funds are separate outcomes. Stable purchase/adjustment/
refund business identities survive replay cleanup and prevent duplicated value.

Required tests: last unit consume versus adjustment, partly used plan, pending
Booking, partial/over-refund/currency mismatch, failure/UNKNOWN/restart, policy
effective boundary, ledger linkage and actual C/D/A refund/status consumers.

## CR-B07-06 — Privacy compatibility and remaining obligations

Authority: approved D/E coordinator/policy publication with each A/B/C/D executor.
The current W06 B fulfillment remains required. Request compatible extensions to
classes/actions/status/artifact/policy and copy-handling obligations where approved;
do not move the W06 provider gate to W07 merely to close another wave.

Freeze request/task/subject-assurance/owner-operation/result/artifact IDs and
revisions, action/class mapping, approved fieldsets, current execution/download
scope, policy/hold/effective-time references and exact retained/partial outcomes.
The [W06 privacy proposal](PRIVACY_FULFILLMENT.md) records B-12, ledger preservation,
intake/completion separation, replay/restore and actual artifact requirements.

Policy/schema upgrades preserve historical task/result semantics through explicit
old/new readers or reviewed majors. New fields cannot turn retained/blocked into
completed. Key/fingerprint binds action/classes/fieldset/policy/subject authority;
UNKNOWN resumes the original owner operation. Projection/artifact cleanup never
deletes postings or claims every downloaded/provider/backup copy was erased.

Required tests: old tasks/new policy readers, revoked/foreign subject, private
fieldset/class changes, legal hold/partial outage, key conflict/lost result,
PII replay/rebuild/restore blocking and actual A/D status/download sessions.

## CR-B07-07 — Financial contribution events and report history

Authority: Billing supplies ledger/payment/refund facts, Wallet approved holder/
hold/projection facts, Subscription benefits/use; D Reporting owns read models.
Request closed events plus bounded history/snapshot/correction/reconciliation
reads with producer ACLs and independently authorized financial fieldsets.

Freeze source operation/business/posting/account/benefit/Booking refs, owner
revisions, correction/reversal lineage, exact approved Money/units, effective
policy/time and safe classification. Reporting must distinguish cash assets and
custody, approved customer Wallet liability, earned amounts, and unused benefit
units/approved value. Received merchant credit, obligation allocation, settlement,
Wallet hold, subscription purchase and earned revenue remain independent facts.

Approve recognition/expiry/refund/valuation policy; do not guess ledger accounts
or treat a Wallet credit or plan purchase as earned revenue. Do not add custody,
provider receipts, Wallet balances and earned amounts into one duplicated total.
Financial event correctness comes from Billing postings; Wallet/Reporting cannot
create a second journal or arbitrary credit. Unused units without approved value
remain units rather than an invented monetary estimate.

Required tests: actual postings and correction/reversal lineage; receipt versus
allocation/usage recognition; cross-currency separation; missing/duplicate/stale
events and current-grant fieldsets; actual D reports/export and B reconciliation.

## CR-B07-08 — Reporting rebuild and app outcome mapping

Authority: B authoritative history/status and C lifecycle sources; D Reporting
projection, A/C/D real consumers. Request owner-specific checkpoint vector,
generation/cursor/filter binding, asOf/coverage/quality/missingRefs and authorized
operation lookup; delayed reports cannot authorize current financial mutations.

Persist Inbox/hash/effect/checkpoint before ACK; dedup by source/business effect,
apply explicit correction rules, repair gaps from real bounded owner history and
keep source order independent across owners. Replay/rebuild cannot credit Wallet,
consume units, issue refunds, resend notices or resurrect redacted personal data.
Publish exact cursor/history/retention budgets and policy-scoped audit for exports.

Candidate display examples requiring A/C/D/design review:

| Consumer | Separate source states to map through accepted contracts |
| --- | --- |
| A purchase/benefit view | Purchase pending / financially qualified / benefit active; reservation held / used / released; failed renewal has its actual eligibility outcome. |
| C rebooking/recovery | Replacement capacity result, benefit result and financial amendment result each show pending/unknown/refused/committed/compensation progress. |
| D Support/admin | Case resolution may finish while B refund is pending; an approved adjustment is not confirmed returned money; price review is separate from publication/effective activation. |
| A/D privacy/reporting | Intake received, owner partial/blocked, export ready and fulfillment completed remain separate; report asOf/gap/coverage does not imply current account authority. |

Required tests: hash conflict/out-of-order/correction/crash/restart/rebuild, stale
or missing source coverage, foreign/revoked export, no repeated side effects,
real independent A/C/D sessions and approved Arabic/English pending/recovery copy.

## Publication and handoff order

E/product settle policies/current auth/Money/shared schema/resource release ->
real B Catalog/Pricing/finance/benefit/privacy/history providers -> C orchestration
and D admin/reporting/coordinator providers -> affected A/C/D consumers and real
serialized journeys. Split cycles into binding/provider/consumer child sprints;
E agrees exact gates and preserves the parent integration barrier. No fixture,
historical green foundation check or unmerged peer implementation closes a gate.
Independent eligible review, accepted immutable bases and actual final-source
checks precede merge; this packet starts no W07 source, merge or deployment.
