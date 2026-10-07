# W10-B — finance scope reconciliation and required candidate evidence

**PROPOSAL_ONLY / ENTRY_BLOCKED / parent NOT_STARTED / FULL_LAUNCH_NO_GO.**
Observed target `8bfa805d033cb29373c33886bf71bce4885a2f67`, tree
`9288ac9a1320221f309ce33b571a057f5ec2ea57`, is source for this analysis, not
E's accepted `BASE_W10` or a finance release candidate. The registry remains W01,
INTEGRATION_PENDING, BASE_W02:null, accepted next-wave contracts `[]`; no accepted
BASE_W10 or exact release-candidate receipt is published. The task's missing-base
exception authorizes this read-only reconciliation and B-local proposal only.

## Evidence classification and current implementation

The [W01 inventory](../W01/SOURCE_INVENTORY.md) defines the source-derived
financial responsibilities and approved reference boundaries. Its old source
snapshot is historical, not current implementation proof. F001 assigns Catalog,
Pricing, Billing, Wallet and Subscription separately. The later
[W07 scope matrix](../W07/FINANCE_SCOPE_MATRIX.md) expands their proposed functions;
merging those packets does not implement or accept the functions. The matrix
below reconciles those responsibilities without reducing the advertised scope.

Current `services/{catalog,pricing,billing,wallet,subscription}/src/app.module.ts`
all declare `BUSINESS_READY=false`; application/ports remain empty. Billing,
Pricing, Wallet and Subscription schemas contain `ServiceMarker` only. Catalog
adds `FoundationProbe`/`OutboxMessage`, not commerce or financial records. Its
actual probe/relay is foundation behavior. The disconnected historical Catalog
`domain/quote.ts` and Billing `domain/ledger.ts` are pure models: integer-string
quote calculation and per-currency balancing validation, respectively. Neither
posts funds, verifies a provider, applies current authorization or stores a
financial receipt. Their source/tests cannot establish finance acceptance.

Packages contracts/event-contracts/api-clients remain **0.0.2 / 0.0.2 / 0.0.1**.
The API-client export is empty; HTTP registry Identity/Gateway foundation/routing
and event foundation.probe/contract-only booking.confirmed do not publish the
required finance business interfaces. Identity authentication/revocation exists,
but broad `billing.read`/`billing.refund` is not complete object/purpose/guest,
cash-collector, Wallet, Pricing or Subscription authority. E must publish the
closed current-authority and owner business profiles before dependent writes.

Customer React code implements session/reference UI: `bookingConfirmation.ts`
explicitly creates neither a durable booking/reservation nor a payment. Its
snapshot assigns `cash_due` or `awaiting_transfer` with `verifiedAt:null`.
Seven steps and optional plate are represented; this is not genuine guest payment
acceptance. `apps/operator-web/src/index.ts` and `apps/admin-web/src/index.ts`
are technical browser boots with `businessReady:false`, not technician collection
or admin finance workflows. HTML references are locked scope, not deployed apps.

Classify future evidence separately as **IMPLEMENTED**, **LOCALLY_TESTED**,
**INTEGRATED**, **STAGING_ACCEPTED**, **RELEASE_READY**, **DEPLOYED** and
**VERIFIED_IN_OPERATION**. Current financial functions below are **NOT_IMPLEMENTED**,
except the explicitly identified pure models/session UI/foundation mechanisms.
Their real acceptance is **NOT_RUN / BLOCKED**. Proposal source guards or hosted
foundation receipts validate only their actual source and executed foundation
scope; they do not promote any financial function into a later classification.

## Full financial scope and missing acceptance

All evidence in this table is required future actual evidence on E's exact
candidate. No test listed here is claimed to have run. “Absent” means absent in
the inspected current source, not an assertion about private external systems.

| Scope | Authoritative owner / consumers | Current source state | Required actual evidence and concrete blocker |
| --- | --- | --- | --- |
| F01 Catalogue publication, package/add-on applicability and duration | Catalog; A/C/D consumers | Commerce models/controllers absent; customer values are fixtures. | Owned DB/revision/publication/current-grant tests; actual approved packages, durations, compatibility and old-snapshot preservation. Approved data/contracts/providers missing. |
| F02 Price-version governance and exact Money | Pricing; D admin | Marker only; historical Catalog helper owns no Pricing state. | Approved currency/exponent/bounds/tax/rounding, append-only effective price versions and authorized admin publication; malformed/overflow/extreme amount tests. Policies/providers missing. |
| F03 Immutable expiring quote and total verification | Pricing; C Booking/A customer | Quote helper/session bill are disconnected models. | Server-issued quote, source revisions, expiry/clock boundaries and hostile client-total rejection; exact accepted Money and policy. Actual quote provider missing. |
| F04 Promotion issuance, holds, redemption and admin changes | Pricing; C/A/D | No durable campaign/coupon/counter records. | Concurrent final allowance, held/claimed/used conservation, permanent business uniqueness, review/audit and permitted linked restoration. No approved campaign policy or provider. |
| F05 Newly priced rebooking | C Booking/Scheduling with Catalog/Pricing/Billing/Wallet/Subscription; A | Session confirmation is not rebooking orchestration. | New current price/catalogue/capacity/benefit authority, immutable old snapshots, expired/changed-price cases and compensation. Real merged owner contracts/consumer journey missing. |
| F06 Obligation and independent payment allocation | Billing; C/A/D | Marker only; no durable financial intent. | Unique server-priced obligation, owner/guest binding, receipt allocation and expired-intent handling; money independent of capacity/work. Actual provider/schema/HTTP grants missing. |
| F07 Required electronic verification and private evidence | Billing; C Media/E routes; A/D | No merchant adapter or genuine financial verification. | Each required route's authentic merchant/environment/protocol/non-money receipt, exact recipient/amount/currency/finality, forged/conflicting callbacks and scoped proof review. Genuine intake/provider evidence missing. |
| F08 Authorized refund and uncertainty | Billing; Subscription/C/E/D consumers | No refund reservation/operation model. | Confirmed plus disjoint reserved/inflight/UNKNOWN exposure bounded by original eligible capture and aggregate purchase; current grant, concurrent requests and original-op inquiry after lost reply. Refund policy/provider missing. |
| F09 Immutable balanced journal and corrections | Billing | Pure balancing helper only; no posted rows. | Real per-currency balanced postings, permanent effect uniqueness, linked corrections, immutable runtime constraints after reprovision and upgrade. No journal provider; E privilege profile requires acceptance. |
| F10 Assigned-work cash collection and receipt lookup | Billing; C work authority/A/operator/D | No cash receipt or collection controller. | Current assigned collector, unique collection/posting, receipt ownership, amount policy, concurrent duplicate collection and real three-app lookup. Actual work/finance provider and app routes absent. |
| F11 Physical custody, handover and company settlement | Wallet custody; Billing collection/treasury; C/D | No holder/custody/handover models; admin HTML is reference. | Independently reconcile collection, physical holder movement, handover acceptance and treasury settlement; short/over evidence and current separation of duties. Actual holder/purpose/cash policies missing. |
| F12 Approved-holder funding and Billing backing | Wallet with Billing; approved operational actors | No account/movement model. | Actual eligible Billing posting/allocation references, approved holder/purpose and independent balance reconciliation. “Funding” is required backing of approved accounts; customer deposit/withdrawal product is not approved. |
| F13 Wallet holds, spend, linked return and recovery | Wallet with Billing/C | No claim/hold/spend/refund provider. | Claim before Billing effect, per-operation backing, double-spend race, restart after lost commit response, disjoint balance/exposure and same original effect. UNKNOWN remains unavailable beyond TTL/revocation. |
| F14 Wash-plan purchase, activation and renewal | Subscription with Billing; A/D | Marker only; no durable term/benefit state. | Actual eligible purchase allocation, unique activation/renewal, valid prior-term preservation and approved expiry/proration/time rules. No automatic recurring debit inferred; real provider/policy absent. |
| F15 Benefit reservation/use/expiry/cancellation | Subscription; C orchestration/A/D | No entitlement/reservation/consumption history. | Final-unit race, consume/release/expiry fences, cancellation/refund eligibility before financial return and independently approved linked benefit correction. Pending return does not restore units. |
| F16 Guest/optional-plate/current access/privacy | Owner object authority; E Identity/C Media/A/C/D apps | Customer session behavior and Identity foundation exist; production grants/private workflows absent. | Genuine guest/registered own/foreign receipt/proof access, absent plate, fresh/revoked collector/reviewer authorization, legal retention/export/deletion and restored access. Accepted contracts/privacy policy missing. |
| F17 Timeout, duplicate/conflicting retry and restart/restore | Each B owner; E/C/D coordination | Foundation outbox exists; financial recovery absent. | Same semantic key replays, changed payload conflicts, second-key business duplication denied; real DB/broker crashes, fresh restore fence, gaps/late callbacks and original UNKNOWN operation inquiry. W08 static defects remain unfixed/unaccepted. |
| F18 Historical lineage, reconciliation and bounded operations | Each B owner; E staging/data owners/D views | W09 profiles only; no importer/reconciler CLI. | Authorized exports or verified absence plus labeled approved fixtures, repeat stable counts/lineage, independent pre/post totals, bounded authorized status/audit and approved monitoring/escalation. No genuine W09 execution evidence. |

## Complete W07-to-W10 coverage crosswalk

The first column below is the **W07 F/G identifier**; the second is this
document's **W10 scope-family identifier**, not a renumbering or closure of W07.
All 35 retained functions and five shared gates appear exactly once. Multiple
families mean one retained function needs independent owner effects and evidence.
Each F row's current status is **IMPLEMENTATION_ABSENT / NOT_RUN**, even when a
pure model, prototype or foundation capability is available. Service-owner labels
identify authority; actual named accountable operators/reviewers remain
**null / UNASSIGNED** for every row. No historical W07/W08/W09 acceptance,
proposal merge or old green source run transfers to W10 or closes this crosswalk.

| W07 requirement | W10 family | Retained behavior and accountable owner roles | Current status |
| --- | --- | --- | --- |
| F01 Definitions and Catalog administration | F01 | B Catalog create/review/publish/retire/history; compatibility, inclusions/durations and immutable historical display resolution; D actual administration. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F02 Server quote and bill composition | F02/F03 | B Pricing server total/breakdown, category surcharge, quantities, duration and included-add-on deduplication; Catalog inputs; A/C actual review. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F03 Currency, applicable fees and taxes | F02/F06/F09 | B Pricing/Billing exact currency/exponent/bounds/rounding and applicable travel/zone/provider fees/tax/invoice treatment; D Configuration publishes approved policy, A/C actual geography/operating inputs. No inferred zero rate. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F04 Quote validity and price retirement | F02/F03 | B Pricing original expiry, effective-time/honoring/revocation policy and immutable historical Booking/receipt snapshots across retirement and replay. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F05 Real Pricing administration | F02 | B Pricing review/hash/approve-or-reject/publish/retire/schedule/history; current scoped grants/CAS and activation-restart/boundary tests; D actual admin consumer. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F06 Promotion publication and applicability | F04 | B Pricing versioned review/publication/retirement, timezone/start/end/audience/market; Catalog item applicability remains independent; D/A/C actual consumers. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F07 Promotion stacking and benefit mix | F04/F15 | B Pricing approved precedence/exclusion/calculation order with Subscription/Billing facts; immutable discount and separate benefit/redemption effects; C orchestration. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F08 Atomic coupon budget and redemption limits | F04/F17 | B Pricing durable reserve/commit/release and global/customer/budget exposure, permanent business uniqueness; real final-allowance/expiry/restart/cross-key races. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F09 Guest promotion limits | F04/F16 | B Pricing current guest eligibility/caps/reset/claim policy; E guest authority and A/C beneficiary binding. Phone/device/plate is not inferred guest identity. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F10 Promotion release and approved restoration | F04/F05/F17 | B Pricing release of uncommitted exposure versus separately approved linked committed-redemption restoration; current C cancel fence; no refund/benefit result implicitly restores allowance. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F11 Current quote for repeat booking | F03/F05 | C Booking/Scheduling current capacity; B current Catalog/Pricing/Subscription and A inputs; new quote/eligibility, unchanged old snapshot and no copied spent benefit/hold/redemption. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F12 Booking amendment and partial compensation | F05/F06/F08/F13/F15/F17 | C lifecycle/capacity amendment and original/replacement fences; B independent money/benefit/promotion receipts, approved difference/refund/fee/consent; cancel/start/amend/crash/UNKNOWN cases. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F13 Obligations and immutable financial ledger | F06/F09 | B Billing valid accounts/obligation/allocation, balanced immutable postings and linked correction; E approved runtime privileges persist through reprovision and real upgrade. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F14 Cash receipt and collection | F10/F16 | B Billing unique actual collection and receipt; current C assigned-work authority; operator collection timing/amount policy and duplicate/foreign/revoked/late/correction cases. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F15 Cash custody and company handover | F11/F12 | B Wallet posting-backed holder custody; Billing collection/treasury; C Workforce actual holder binding and independent receiver acceptance/current separation of duties. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F16 Cash shortage, overage and correction | F08/F10/F11/F18 | B Billing/Wallet preserve original facts and reviewed discrepancies/linked correction; C work facts/D Support case; partial/refused/concurrent handover/correction tests. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F17 Genuine ShamCash route | F07/F08/F18 | B Billing separate merchant/protocol/non-money verification/refund/status/settlement evidence; provider/account owner authentic approval; A/C/D actual route, including loss/reorder/UNKNOWN. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F18 Genuine Syriatel Cash route | F07/F08/F18 | B Billing and its actual provider/account owner supply separate genuine route/evidence; ShamCash protocol or acceptance cannot substitute; A/C/D actual route. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F19 Resolve required Paymera scope | F07/F08/F18 | Product/provider owner records required relationship and genuine documentation; B/E/A/C/D implement any required reviewed route. OPEN remains a blocker, not inferred exclusion or fourth UI method. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F20 Evidence intake and authorized payment verification | F06/F07/F16 | B Billing validates review-only reference/proof, exact financial match, current reviewer CAS/audit; C private Media and late-capacity facts; E grants; competing/foreign/quarantined/revoked proof tests. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F21 Partial/full refund cap and execution | F08/F13/F15/F17 | B Billing reserves original-capture and aggregate-purchase allowance including UNKNOWN; provider actual return/status; C lifecycle/D Support inputs; pending approval distinct from confirmed return. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F22 External settlement and financial discrepancy tools | F07/F09/F11/F18 | B Billing distinguishes merchant credit, obligation allocation, provider settlement/fees and treasury receipt; actual statement/import/status/correction; D Reporting/Support/admin permitted views. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F23 Approved Wallet accounts, balances and holds | F12/F13/F16 | B Wallet approved holder/purpose/currency, exact posting-backed available/held/claimed partitions; current permitted A/C/D reads; final-funds and foreign-purpose cases. Missing data is not zero. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F24 Fenced Wallet capture and UNKNOWN recovery | F13/F17 | B Wallet command-bound claim before Billing effect, original posting recovery and definitive fenced noncommit; E accepted no-effect release profile; never fabricate required posting references. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F25 Approved Wallet refund routing | F08/F12/F13 | B Billing money and Wallet approved destination/movement once; actual holder/purpose/current beneficiary/currency policy, fallback and lost-response reconciliation; no inferred customer funding product. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F26 Customer Subscription plans, activation and admin | F14/F16 | B Subscription approved plans/eligibility/versions/current admin transitions with Catalog/Pricing/Billing inputs; actual eligible allocation activates benefits; A/D approved production views. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F27 Subscription renewal and prior-term status | F14/F17 | B Subscription separate renewal/pending/failure and independently valid prior term; approved freeze/resume/period/timezone/rollover/cancellation terms; no automatic debit/capacity booking. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F28 Benefit reserve, consume and release | F04/F15/F17 | B Subscription final-unit/current-term qualification and fenced consume/release/expiry; current C Booking purpose; mixed promotion/cancel/use/revocation/restart tests. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F29 Plan adjustments, Subscription refunds and benefit reversals | F08/F14/F15 | B Subscription plan change/proration/cancellation/units and Billing refunds/postings; original purchase/use/correction lineage and eligibility fence; C use/D remedy; retained consumed history. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F30 Statements, real receipts and historical reads | F03/F09/F10/F11/F12/F14/F16/F18 | B owner immutable financial/benefit/custody history, actual receipts/statements with revision/as-of/coverage; A/C/D scoped downloads/pagination/correction/history; legal invoice treatment separately approved. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F31 Financial disputes and Support remedies | F08/F11/F15/F16/F18 | D Support case/decision; B independent money/benefit remedy and C facts; current object scope, decision revision, raced/revoked/UNKNOWN outcome. Case closure cannot assert returned funds. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F32 Reconcilable events, source history and financial Reporting | F04/F09/F11/F12/F14/F17/F18 | B owner versioned contributions/history/cursors/corrections; D actual projections/rebuild/export with exact currency/units/recognition and no double counting; hash-conflict/gap/crash/privacy tests. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F33 Full A/C/D financial state and error mapping | F01–F18 | B closed state/error/current-authority facts; E transport; real A/C/D cash/electronic/Wallet/Subscription/promotion/rebook/admin journeys, truthful UNKNOWN/next action and approved production copy/states. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F34 Financial privacy export/task/status | F16/F18 | Each B executor and accepted coordinator verifies subject/task/action/fieldset; C real private artifact, coverage/digest/current download access; A/D partial/status views and own/foreign/two-guest/restart tests. | IMPLEMENTATION_ABSENT / NOT_RUN |
| F35 Anonymization, retention and copy obligations | F09/F15/F16/F17/F18 | B eligible identity/contact actions preserve posted money/use history; all copy owners/coordinator report retained/partial/blocked/legal-hold outcomes; event/log/export/provider/backup/restore obligations require real evidence. | IMPLEMENTATION_ABSENT / NOT_RUN |

| W07 shared prerequisite | W10 families/gate | Retained closure and accountable roles | Current required closure |
| --- | --- | --- | --- |
| G01 Actual common release | F01–F18 entry | E and actual producer/consumer reviewers publish BASE_W10/RC, precise Money/time/revision/null/error/HTTP/event/client versions and isolation/gate allocation. | NOT_PUBLISHED / NOT_RUN; named reviewers UNASSIGNED |
| G02 Current authority | F16; all actions | E Identity/Gateway, A/C object providers and each B executor; current scoped guest/service/action/purpose/revocation and transport at execution/replay/status/download. Existing Identity foundation does not close finance grants. | IMPLEMENTATION_ABSENT / NOT_RUN for required finance scope; named owners UNASSIGNED |
| G03 Real producer evidence | F09/F17/F18; every provider | Actual service owners/E role-allocation validate owned DB/append-only upgrade/immutability, HTTP/current Identity, contracts/audit/atomic receipts/outbox/inbox and crash recovery. | IMPLEMENTATION_ABSENT / NOT_RUN for financial producers; named owners UNASSIGNED |
| G04 Serialized complete three-app gate | All five journey sequences below | E serialized latest-target-plus-head candidate/resulting target; merged real B/C providers before A/C/D consumers; unchanged refs and eligible independent review. | NOT_RUN; actual candidate/reviewer identities null / UNASSIGNED |
| G05 Adversarial/workload/recovery handoff | F17/F18 plus concurrency in F04/F08/F13/F15 | B real producer scenario/error/workload records; C saga/D projection; E approved environment/budgets and measured demand/fault/performance/restore results. The W08 packet supplies proposals only. | NOT_RUN / NOT_MEASURED; approved budgets/actual operator identities null / UNASSIGNED |

Current D source reinforces the distinction: Support contains ServiceMarker only;
Reporting has InboxMessage/ProbeProjection for nonfinancial probes, not financial
cases/revenue/liability/custody reports. Its future projection cannot authorize a
posting, refund or remedy, and must preserve source gaps and historical corrections.
No second ledger, unapproved earnings model or summation of collection, custody,
Wallet backing and merchant settlement as separate revenue is permitted.

F34/F35 retain the current required privacy predecessor, not a deferred follow-up.
An export task's intake ACK is not extraction or completed fulfillment. Real
private artifact bytes/manifest/coverage and current reauthorized download are
required; a demo receipt-text export does not close financial export. A permitted
customer-receipt class cannot expose third-party/team custody or other benefit
records without an approved explicit class/fieldset. Policy must specify owner
actions, start triggers/periods, jurisdiction/holds and copy obligation coverage
for queues/DLQs, logs/traces, caches, reports/replicas, artifacts/downloads,
providers and backup restore. Replay/rebuild/restore must reapply approved
redaction/tombstones before access. Pseudonymization/access revocation cannot
assert universal anonymity/erasure, and privacy cannot delete posted journals,
consumed history or abandon original unknown operations. Actual policies,
executors, copy receipts and independent acceptance remain null / NOT_RUN.

Cash, ShamCash and Syriatel Cash remain the approved UI methods. **Paymera scope
is OPEN** pending the owner decision and genuine provider documentation; required
coverage cannot be silently omitted or added as a fourth checkout method. Wallet
is internal custody/backing, not automatically a fourth payment rail. No payroll,
marketplace/provider plan, customer stored-value product or automatic debit is
introduced. Aleppo prices/geography/hours and real money policies remain actual
approval inputs; prototype SYP/SAR/+966 data cannot decide them.

## Exact-candidate three-app acceptance sequence

E must first publish the real finance providers, compatible owner clients and
current authority/Media/C capacity protocols, then queue actual A/C/D consumers.
Consumers use merged real providers and prove their full journey before consumer
merge. These are required combined-source runs, not fixtures or new peer tasks
assigned by this proposal. Each binds exact source/tree/images/config/contracts,
run/attempt, allocated resources, independent expected results and actual evidence.

1. **Cash across customer/operator/admin:** registered customer and guest book
   through all seven steps with present and absent plate; C confirms current
   booking/capacity. The currently assigned operator collects once and obtains
   a genuine Billing receipt. Customer accesses only the owned receipt; admin
   reconciles Wallet custody, handover and independent company settlement with
   current authority. Test concurrent duplicate collection, revoked collector,
   foreign receipt and recorded cash discrepancy; totals are independently sourced.
2. **Every required electronic route:** customer submits scoped proof/reference
   without obtaining paid status. Genuine approved non-real-money merchant or
   independent verification establishes the authoritative outcome. Admin's
   currently authorized reviewer handles exact matched/mismatched/forged/duplicate
   evidence and refund review. Operator sees independent work facts, not a payment
   screenshot as authority. Reconcile actual receipt/refund/exposure in all apps;
   missing required provider capability/evidence blocks the full advertised launch.
3. **Wallet and subscriptions:** approved holder funding/backing, hold/spend and
   linked return use real Billing references; these are operational owner actions,
   not a new checkout option. Customer wash-plan purchase/renewal, C reservation/
   consumption/cancellation and admin adjustment reconcile actual allocation,
   terms/units and backing. Test final-balance/final-unit races, loss after commit,
   expiry and pending refund without granting availability/benefits prematurely.
4. **Promotions and rebooking:** admin publishes approved price/promotion changes;
   customer and guest receive actual new quotes; C revalidates current capacity
   and benefit allowance. Preserve the original snapshot and tested expiry rules.
   Test final coupon allowance, conflicting retry, second-key duplicate and late
   payment after expired capacity. Only C can allocate new capacity; a financial
   success cannot recreate a slot, assignment or completed work.
5. **Restart and restore:** E's allocated real restore reconciles original per-
   currency immutable journals, refunds, Wallet backing/exposure, units, promotion
   exposure, physical custody and unresolved external operations against the
   genuine pre-fault record. Replay callbacks/inbox/outbox once and reject surviving
   old workers. Current guest/task/object/auth and privacy restrictions apply
   before disclosure or execution. A/C/D compare real owner facts and honest gaps.

Every route includes current authorization on initial request, replay/status and
private access; independent customer/operator/admin identities; exact retry
fingerprints; bounded timeouts; error and UNKNOWN presentation; currency limits
and financial/service-state separation. Transport success, broker ACK or elapsed
deadline cannot assert committed money. A lost response retains the original
operation/claim and safe same-operation recovery. Generic gateway errors cannot
conceal financial uncertainty or manufacture a retryable definitive failure.
No real-money payment/refund is authorized merely to complete these tests.

## W09 evidence and unresolved-money classification

W09-B [entry](../W09/README.md), [W10 intake](../W09/W10_FINANCE_HANDOFF.md) and
its 24 acceptance specifications are proposals with **NOT_RUN** business cases.
Original exports, genuine rows/counts/opening balances, import receipts and
reconciliation totals are null / NOT_PROVIDED. Verified absence is false /
ABSENCE_NOT_VERIFIED. Missing export access is not an authenticated empty source.
Genuine merchant/non-money acceptance, actual staging restore, repeated callbacks,
three-app totals and named independent finance review are also not provided.
Existing source/foundation receipts do not supply those results retrospectively.

The actual pending-money/benefit/custody/provider inventory is **null /
NOT_PROVIDED**, not `[]` or zero. A legitimate pending state requires actual owner
identity, original operation/fingerprint, exact per-currency disjoint exposure,
causal evidence/coverage, approved lifecycle/recovery deadline, current accountable
owner and monitoring/reconciliation procedure. Pending UNKNOWN retains claims
until authentic outcome or definitive fenced noncommit; timeout/TTL is not proof.
Unexplained differences, missing backing, over-cap returns, unaccounted custody,
or unknown unenumerated operations remain blockers, not approved pending states.

| Required release evidence | Actual value/status |
| --- | --- |
| Accepted BASE_W10, serialized candidate, candidate parents/tree and resulting target | null / NOT_PUBLISHED or NOT_RUN |
| Retained deployed image digests, dependency/configuration receipts | null / NOT_PROVIDED; source lock is not a deployment receipt |
| Applied finance migration IDs, clean/populated upgrade and runtime constraints | null / NOT_RUN; existing foundation migration files are source only |
| Accepted Money/financial/holder/privacy/provider policies and finance clients | null / NOT_PUBLISHED |
| Provider environments, genuine route acceptance and unresolved-operation inventory | null / NOT_PROVIDED |
| Independent finance reviewer, named operating owners and release signoff | null / UNASSIGNED / NOT_PROVIDED |
| Exact candidate three-app/restore/reconciliation results and protected evidence | null / NOT_RUN |

Each missing item must receive an accountable owner decision and genuine source-
bound receipt; role labels do not assign actual reviewers. If source/config/
evidence changes, E recomputes applicable candidate and integrated acceptance,
verifies unchanged refs and checks the actual resulting target. No head's earlier
green run transfers to another candidate, squash, deployment image or release.
This packet supports a reviewed **NO_GO** recommendation until every required
function/provider and mandatory evidence is resolved; it is not finance signoff,
self-approval, permission to merge/deploy or an autonomous production operation.
