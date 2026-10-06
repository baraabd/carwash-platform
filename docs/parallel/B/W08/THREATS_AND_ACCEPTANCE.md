# W08-B — financial threats and required real acceptance

Status: **PROPOSED_NOT_ACCEPTED / NOT_IMPLEMENTED / ACCEPTANCE_NOT_RUN**.
Parent: **NOT_STARTED**. Full-launch disposition: **NO_GO**.

Observed target is `main@f0b76221c1a1991ba78327c019f0b4a0a7c53dff`, tree
`1a6b3a54e926fc9e3387ac547ecc20c3d3f4252d`. This is not BASE_W08. E has
not published that base or frozen financial API/client families. All five B
services advertise `BUSINESS_READY=false`; Billing, Wallet, Subscription and
Pricing have empty application layers and only ServiceMarker business schemas.
Catalog's foundation probe/Outbox is an actual technical delivery path, not a
money provider. Merged W07 proposal packets establish neither completed finance
implementation nor the acceptance below.

This is the task-authorized read-only analysis and B-local proposal path. It
proposes no shared package, public endpoint, policy, role, resource allocation or
new checkout method. Current package versions remain contracts/event-contracts
`0.0.2` and api-clients `0.0.1`; business client exports are empty. The strict
`booking.confirmed.v1` contract is not a financial acceptance proof.

## Threat model and invariant oracle

Trust boundaries are caller-to-owner HTTP, current E authority, owner-to-owner
published contracts, owner-local transactions, broker delivery and genuine
provider evidence. A customer/guest, previously permitted staff member, compromised
caller, duplicate worker, stale projection or forged callback can cross one
boundary without gaining authority across the others. Gateway/admin own no money
or private evidence. Never import peer implementations, read peer tables or use a
report/proof upload as a financial decision.

| Threat / affected owner | Required invariant and narrow repair direction | Real acceptance IDs |
| --- | --- | --- |
| Caller supplies totals, wrong currency, malformed decimal, unsafe identifier or excessive magnitude — Pricing/Billing | Derive actual totals from accepted immutable owner references and approved Money policy. Validate closed types, canonical amount, currency/exponent and bounds before effects. Use exact integer arithmetic; no float coercion, default currency, implicit conversion or zero on outage. | NUM-01, NUM-02, NUM-03 |
| Same key with changed meaning, new key for the same business effect, hash/key collision or replay after expiry/restore — every B owner | Persist canonical fingerprint and durable business/effect uniqueness with the result. Same meaning recovers the original receipt after current authorization; changed meaning conflicts. Caller keys and expiring replay caches never define financial uniqueness. | IDEM-01, IDEM-02, REC-07 |
| Cross-customer/two-guest access, substituted beneficiary/holder/purpose or private proof locator — every B owner; C Media | Current object/action/purpose/market/beneficiary authority binds command, status, replay, page, export item and download. Guessing an ID, optional plate, phone, Support case or broad staff role supplies no ownership. | AUTH-01, AUTH-03 |
| Revoked collector/reviewer/publisher, stale authVersion/service grant or Identity outage — B execution with E authority | Critical authorization fails closed when its authoritative check is unavailable. Reauthorize retries and reads; delayed privileged workers need the accepted current execution authority/fence. Revocation or denial does not prove a pending external money effect never committed. | AUTH-02, AUTH-04, REC-03 |
| Forged/reordered/duplicate provider message, wrong merchant or amount, uncertain submission/query/refund — Billing/provider owner | Validate the documented genuine protocol, merchant, currency, business correlation and actual credit/finality. Keep independently verified receipt and allocation separate. Preserve the original provider operation and reserved exposure during UNKNOWN; no fresh-key blind resend or proof-implies-payment. | PROV-01, PROV-02, REC-03 |
| Two collectors/refunders, distinct endpoints or partial/full refund race — Billing | Immutable per-currency balanced journals; exactly one receipt/effect per actual business identity. Atomically reserve cumulative refund exposure against eligible original captured funds and approved cap, across original sources and aggregate purchase. | SQL-01, SQL-05, SQL-06 |
| Last-funds Wallet spend, hold expiry/revocation or missing Wallet update after Billing commit — Wallet/Billing | Approved holder/purpose movements have real Billing backing. Claim before possible capture; available, claimed and completed partitions do not overlap. UNKNOWN remains unavailable beyond TTL/lease expiry; release requires definitive noncommit with late execution fenced. | SQL-02, REC-02, REC-03 |
| Last-unit consume versus expiry/release/refund, failed renewal or orphan reservation — Subscription/Billing | Activation depends on actual eligible Billing effect. Preserve consumed history; claim/fence adjustment eligibility before monetary refund. Units, reservations and corrections are conserved under approved term/expiry policy; no automatic renewal debit or timeout-created units. | SQL-03, SQL-05, REC-04 |
| Final coupon, budget or guest/customer limit raced; delayed restoration or stale price publication — Pricing/Catalog | Persist held/claimed/used exposure and approved count/budget limits. UNKNOWN does not restore headroom. Historical quote/publication snapshots remain immutable; redemption, monetary refund and approved restoration are independent effects. | SQL-04, SQL-07, REC-04 |
| Duplicate collection/transfer/company receipt or unexplained physical difference — Billing/Wallet; C work facts | Independently reconcile actual collection, approved holder movements and company settlement per currency without another journal. Preserve disputed and unallocated funds; no fabricated credit, silent deletion or settlement inferred from work completion. | SQL-01, REC-05, INT-01 |
| Crash at commit/send/confirm/ACK/mark, expired lease/stale worker, publisher lifecycle leak or conflicting event ID/version — B producers/consumers with E broker | State, effect, receipt, audit and Outbox commit locally together. Inbox ID/hash/effect/checkpoint commit before ACK. Fenced lease finalization, bounded retries and durable recovery preserve original identities. Publisher/channel listeners and pending work have bounded lifecycle/cleanup. Gaps/conflicts/unsupported versions expose incomplete coverage, never new value or fabricated zero. | REC-01, REC-06, REC-07, REC-08 |
| Runtime SQL journal mutation, reprovisioned privileges or privacy repair erasing history — Billing/E; all privacy executors | Enforce balanced immutable posted history through real DB constraints and privileges after fresh install, upgrade and E reprovision. Append linked corrections. Logs/events/errors/export fields obey approved privacy and retention; restore does not revive revoked disclosure or erased projections. | SQL-06, AUTH-03, AUTH-05, REC-07 |

For each currency and approved source scope, the eventual oracle requires:

- Every posted journal has equal exact debit and credit totals; posted rows remain
  immutable and corrections link the original posting. Unallocated received funds
  remain visible independently of Booking eligibility.
- Confirmed refund amounts plus disjoint unresolved reservations/inflight/UNKNOWN
  amounts never exceed the approved cap or eligible captured funds. Confirmation
  consumes its reservation atomically rather than counting it twice.
- Wallet's original Billing operation/posting references reconcile once; spendable
  funds exclude unresolved claims. Neither held cash nor an entitlement unit is
  automatically customer stored value.
- Subscription units and Pricing promotion exposure conserve their approved
  original grants/limits plus linked corrections. Pending refunds do not restore
  units, coupon use or budget. An expired term/promotion cannot gain usable value
  from an unapproved delayed correction.
- Physical collection, holder custody and treasury receipt independently reconcile
  to their actual source histories. Missing source coverage is unavailable, not
  zero, and explained versus unexplained differences remain distinct.

These are required logical invariants, not an invented accounting classification
or approved commercial policy. Numerical limits, supported currencies/exponents,
rounding, tax/fees, recognized-revenue rules, refund destinations/eligibility,
benefit expiry/proration, promotion stacking and business timestamps remain owner
decisions. Tests cannot choose convenient values to make these decisions disappear.

The W01 proposed closed `wallet.hold-resolve.v1` requires nonempty unique
`billingPostingIds` for both CONSUME and RELEASE. A no-effect release cannot submit
empty or invented postings; E must accept a compatible separate family or new
action-discriminated major and common base before that path is implemented.

## Required execution protocol

All case IDs below have the prefix **W08-B-** and are **NOT_RUN**. They are stable
acceptance requirements for the lane-local machine specification. Short IDs in
tables are not published wire schemas, executable script names or passed checks.

Before execution, E records the actual accepted base/contracts, exact command,
isolated DB/runtime/migrator roles, queue/object prefixes, ports/output paths,
current actors, authorized provider environment and one allocated heavy slot.
Product/accounting supplies immutable policy and dataset provenance; E supplies
approved budgets and harness fault controls. No real finance infrastructure or
provider connectivity is claimed by this proposal.

For SQL cases use separate real connections and barrier-controlled competing
transactions, not Promise concurrency over a mock store. Query durable receipts,
constraints and effects after all workers terminate and after restart. For fault
cases record the exact reached boundary, owned process ID, image/source identity,
local committed facts, external observation and durable recovery outcome. Inject
only into the E-allocated disposable environment; no broad process kills or
shared/production resets. A fixture can model a provider fault but cannot establish
actual provider credit, protocol finality or connectivity.

Positive controls prove each permitted action first; denied controls use the same
real endpoint and actual current Identity authority. A timeout/denial after possible
execution remains a separately tracked UNKNOWN operation. E must freeze revocation
ordering, execution-fence semantics and the accepted treatment of already submitted
irreversible effects; a previous check cannot imply atomic cross-service revocation.

Every result carries exact source/head/tree and candidate/target, contract/policy/
provider versions, run/attempt, exact command, environment names, input dataset hash,
redacted before/after owner facts, expected/observed invariant, artifacts and
PASS/FAIL/BLOCKED. No source repair is accepted from an abstract model alone.

## Acceptance cases

### Input, replay and current authorization

| ID | Experiment on real accepted providers | Required observable outcome |
| --- | --- | --- |
| NUM-01 | Submit altered price/tax/discount/total, incompatible immutable quote refs, wrong currency/exponent and cross-currency aggregation; include valid approved positive controls. | Reject before effects or derive the accepted authoritative total; no caller-supplied price authority or mixed-currency journal. |
| NUM-02 | Test each approved currency's smallest/largest supported amounts and approved rounding boundaries; send overflow, exponent notation, float/NaN/coercion shapes, signed/leading/whitespace malformed decimals and unsupported precision. | Closed parser and real DB constraints agree; exact accepted arithmetic or safe refusal; no truncation, overflow or implicit conversion. |
| NUM-03 | Send hostile IDs/key sizes/path/control characters, foreign refs and unexpected fields; inspect HTTP errors, events and service logs using approved nonsecret privacy sentinels. | Bounded validation under the accepted format; no injection, unbounded lookup, payload echo, existence leak or private sentinel leakage. |
| IDEM-01 | Concurrent same key/same meaning, then changed beneficiary/Money/purpose/policy/revision/quote/fence; repeat after restart. Exercise approved canonical set/order/null semantics. | One original effect and stable authorized receipt; changed meaning conflicts. Canonicalization distinguishes all material business meaning without transient credentials. |
| IDEM-02 | Repeat one business effect under distinct keys/endpoints/staff sessions and after approved cache expiry; submit colliding key/fingerprint inputs under the accepted protocol. | Durable business constraints prevent duplicate effects; foreign replay is denied and conflicts do not disclose another actor's receipt. |
| AUTH-01 | Separate own/foreign customers and two guests attempt commands/status/replay/history/export using substituted subject/Booking/plan/holder/purpose and guessed private refs. | Current bound object/purpose/beneficiary authority on every surface; valid own scope passes; phone/plate/known IDs do not grant access. |
| AUTH-02 | Revoke collector, reviewer, refund actor, publisher and recovery-service authority between admission/execute/retry/status/replay; expire or substitute authVersion. | Accepted current execution authority/fence denies stale new effects and disclosure; existing possible effects retain recovery identities and exposure. |
| AUTH-03 | Read proof/receipt/export as owner, foreign guest/customer, unrelated staff and Support actor; revoke between pages, export items and signed/private download. | Actual Media/B owner checks protect each item/download; artifact or Support access does not imply financial/private scope; no signed locator leak. |
| AUTH-04 | Make authoritative Identity/object-purpose validation unavailable on command, worker retry, privileged repair and replay. Restore authority and retry the original operation. | Critical authority fails closed; no cached broad grant fallback. Original pending/UNKNOWN result is reconciled safely after current authorization. |
| AUTH-05 | Execute approved anonymize/retention/hold and restore/rebuild; scan redacted logs/errors/events/exports and actual copies for approved sentinels. | Posted history stays immutable; retained exceptions are explicit; revoked access and approved suppression survive replay. Unhandled required copies prevent completion. |

### Real database contention and persistent constraints

| ID | Experiment on real owned databases | Required observable outcome |
| --- | --- | --- |
| SQL-01 | Race cash collection for one obligation with original and distinct keys/collectors; race custody transfer/acceptance and company settlement with duplicate/partial/mismatched evidence. | One policy-valid receipt/effect per actual business identity; collection, holder movement and treasury receipt independently reconcile; differences remain reviewed facts. |
| SQL-02 | Race final spendable funds across holds/capture/release/expiry, including distinct keys and Billing response loss. Restart before resolution. | No negative available funds or double capture; command-bound UNKNOWN claim stays unavailable; recovered original Billing effect backs one Wallet movement. |
| SQL-03 | Race final entitlement reserve/consume/release/expiry and refund adjustment at approved exact boundary; test failed renewal with an independently valid prior term. | Actual owner constraint/claim/fence yields policy-valid conserved units; consume history stays; no refund on stale eligibility or prior-term cancellation inferred from failed renewal. |
| SQL-04 | Race final campaign use, global exact budget, per-customer and guest limits; mix approved benefit/promotion stacking and cancel/restoration with delayed workers. | Held/claimed/used exposure cannot exceed approved caps; one permitted final use; UNKNOWN and unapproved restoration create no new headroom. |
| SQL-05 | Race distinct-key partial/full refunds across original payments, allocations and aggregate purchase; overlap plan consume/adjustment and Wallet destination substitution. | Cumulative disjoint exposure stays within both per-source and purchase caps; exact approved route; eligibility claim survives uncertainty; no automatic unit/promotion restoration. |
| SQL-06 | Fresh install and upgrade existing owned DB without reset; raw runtime SQL attempts unbalanced posting, posted UPDATE/DELETE, invalid account/currency/amount, duplicate business effect and peer DB access; repeat after E reprovision. | Actual constraints/roles enforce balance, immutability, bounds, uniqueness and ownership after every path. Permitted migrator append-only upgrade and linked correction still work. |
| SQL-07 | Race reviewed-content amendment/publication/retirement and delayed worker execution at approved effective/expiry/clock boundaries; rebook against changed/retired Catalog/price/quote. | CAS/revision and current grants protect approved publication; old snapshots stay immutable; rebook uses current quote/consent and actual new C capacity. |

### Fault, restart, uncertainty and history recovery

| ID | Experiment on allocated real services | Required observable outcome |
| --- | --- | --- |
| REC-01 | Crash before/after local transaction commit and restart; make DB unavailable at commit and broker unavailable after commit. Cover actual orphan-intent handoff and Outbox enqueue. | No partial state/effect/receipt/audit/outbox commit; committed operations remain queryable and recoverable; ambiguous commit is looked up under original identity. |
| REC-02 | Commit Billing, lose reply and crash before Wallet application; restart with duplicate/gapped/correction-first delivery and later missing-update reconciliation. | One actual posting-backed movement; claimed funds remain unavailable during missing evidence; projection/status recovery never posts another journal. |
| REC-03 | Crash before send, after provider may accept, after genuine response and before local confirmation; make query unavailable, then prove accepted definitive failure or actual credit/refund. Revoke actor/expire lease meanwhile. | Original operation/allowance/claims survive; UNKNOWN neither releases value nor triggers blind new send. Definitive no-effect resolution fences late work; confirmed effects are recorded once. |
| REC-04 | Leave benefit/promotion reservation gaps around consume/expiry/cancel/refund; fail compensation and restart; deliver stale release/restoration after committed effect. | Durable owner reconciliation uses actual current refs/fences; preserves history/exposure and caps; routes contradiction to review without inventing units or coupon budget. |
| REC-05 | Reconcile genuine collection, holder custody, handover and company receipts with missing/duplicate/wrong-currency/unexplained records; restart an audited repair command. | Per-currency explained/unexplained differences remain distinct; one permitted repair receipt with actor/reason/source refs; no balancing credit/deletion or doubled treasury receipt. |
| REC-06 | Crash publisher after lease acquisition on final attempt, before/after broker confirmation and before/after markPublished; fail DB at local publication/failure marking; race lease expiry/reacquisition and stale markPublished/markFailed. Crash consumer before/after effect/Inbox commit/ACK; resume a pre-restore worker against rolled-back lease counters and the accepted fresh restore incarnation. | No indefinitely invisible row or stale worker state regression; original event survives restart as published/recoverable/audited terminal outcome. Duplicate delivery produces one durable consumer effect, not exactly-once broker claims. |
| REC-07 | Deliver same event ID/same hash, changed hash, stale/reordered/gapped/unsupported versions and correction-before-original; expire approved history cursor, rebuild projection and restore approved dataset. Resume old consume/release/repair workers when restored counters repeat, under the accepted new restore-incarnation fence. | Conflict/version quarantine and bounded owner resync; per-owner coverage remains honest. No command replay/new IDs to manufacture money, units, custody or notifications; business uniqueness and privacy persist. |
| REC-08 | Repeatedly construct/use/dispose the actual publisher, reconnect its real broker channel and inject confirmation/error/close during in-flight work; observe retained listeners and resource handles on the allocated scope. | Listener/channel/pending-work lifecycle stays bounded against approved budgets, each callback settles its own operation once, and disposal preserves honest unknown outcomes without leaked stale handlers or duplicate financial effects. |

REC-06 and REC-08 include the independently analyzed Catalog foundation Outbox
final-attempt/stale-finalization and publisher listener paths. Any local
source/model probe is separate diagnostic evidence; it does not mark their real
DB/broker gates passed. A technical foundation fix also cannot establish the
absent financial Outbox/inbox system. Cross-owner technical publisher repairs
remain E-owned even when the affected Catalog caller is B-owned.

### Genuine provider, combined integration and approved performance

| ID | Experiment and required producers | Required observable outcome |
| --- | --- | --- |
| PROV-01 | In each required genuine authorized merchant environment, send forged/duplicate/reordered messages; wrong merchant/recipient/ref/amount/currency; actual valid credit and independently obtained finality/status. | Only authenticated correctly correlated evidence establishes received funds; allocation remains separate; proof image/navigation/fixture never establishes credit. |
| PROV-02 | Execute allowed genuine partial/full refund, uncertain submission/query and settlement/discrepancy protocols for each required route; record actual provider version and evidence. | Actual confirmed return and linked immutable posting once; UNKNOWN retains cumulative allowance. Unsupported required finality/query/refund/reconciliation remains a blocker. |
| INT-01 | E serialized actual cash and every required electronic customer/operator/admin journey against merged Billing/Wallet/Subscription/Pricing/C producers; include private receipt/proof, stale grants, reconciliation and failed compensation. | Independent source facts and current authorization converge; mandatory W07 full journeys remain required before affected consumer merge; report partial/UNKNOWN states truthfully. |
| INT-02 | Expire/release real C Scheduling/Booking capacity before late received/allocated payment and delayed duplicate callback; race compensation/rebook. | C capacity remains authoritative; late money cannot revive expired resources. Actual original-payment reconciliation/approved refund is independent of a new current Booking. |
| PERF-01 | Run the approved measured dataset/concurrency/payment/plan/promotion mix through actual accepted providers; measure latency/throughput/locks/resources/event lag and post-load invariant totals. | Compare to explicitly approved budgets on identified environment; exact outcomes reconcile. Record measurements and failures, without invented SLA, sample size, hardware or demand. |
| PERF-02 | Run agreed outage/restart/backlog and stuck-operation/custody query workload with approved recovery/age/queue/page budgets; include slow/foreign scope and source-gap reads. | Bounded pagination/current scope, telemetry and audited repairs; observed recovery/backlog/latency versus approved limits; no unbounded scan, private metric labels or fabricated complete totals. |

Visible approved methods remain Cash, ShamCash and Syriatel Cash. Each required
electronic route has its own genuine-provider gate; Paymera's unresolved required
scope cannot be silently omitted or turned into a fourth UI method. Internal
Wallet does not add customer funding/withdrawal, payroll or marketplace products.
Current provider evidence and every performance value above are unavailable;
expected/observed numerical results are null/unavailable, not zero or passing.

## Provider-first child queue and disposition

These child names are requests for E agreement, not accepted bases, published
contracts, started branches or completed gates. Resolve missing W03–W07 predecessor
implementations first. Split C's narrow lifecycle/binding/fence producer from its
later B-consuming saga where required; do not make the narrow provider depend on
its future full consumer journey.

1. **W08-E-ENTRY-AND-RESOURCES**: E publishes actual BASE_W08, accepted Money/
   authority/recovery/event/public-client profiles, genuine provider prerequisites,
   isolated roles/namespaces, approved datasets/budgets and exact gate commands.
2. **W08-B-OWNER-INTEGRITY-PROVIDERS**: B narrow service-specific corrections,
   migrations and durable recovery against accepted and merged predecessors.
   Accept real owned DB/HTTP/current Identity/constraint/provider conformance first.
   Queue the Catalog foundation delivery correction as a separately bounded child
   if E accepts it; do not bundle missing financial implementation into that fix.
3. **W08-B-CONSUMER-RECOVERY**: apply each actual merged producer's public contract
   to dependent B consumers, then real C Booking/capacity compensation. Prove
   commit/send/reply/ACK/replay/restart invariants with actual services before
   consumer acceptance, without an unmerged peer branch or production fixture.
4. **W08-A-C-D-FINANCE-INTEGRATION**: actual customer/operator/admin/private-media/
   operational consumers after their providers; E serializes all required journeys,
   current authority, source reconciliation, late-capacity and measured performance
   cases before affected consumer/integration merge.

Parent stays NOT_STARTED under the current proposal path and becomes
INTEGRATION_PENDING only when actual authorized implementation starts. DONE needs
resolved critical defects, all required real recovery/integration cases, genuine
required-provider acceptance and measured approved-budget performance. Green
foundation CI, a model probe, merged documents or same-account peer review cannot
close those gates. E must rebuild latest-target candidates, verify unchanged refs,
obtain eligible independent review and validate the actual resulting target.
This packet authorizes no merge, automatic next wave, live money or production
exercise.
