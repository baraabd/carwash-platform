# W05-D financial operations and convergence plan

Status: **UNACCEPTED LANE-LOCAL PROPOSAL / ENTRY BLOCKED / IMPLEMENTATION NOT STARTED**.
Observed source: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`;
tree: `cc3517ec85525c7310fe340397506ef6be3fe0a9`.
This observed source is not an accepted `BASE_W05`.

This child writes only this document. It proposes later D-owned admin,
Communications, Reporting and applicable Configuration behavior against accepted
providers. Billing/Wallet remain B-owned; Media/Booking/Scheduling/Dispatch remain
C-owned; Identity/Gateway/shared contracts, clients, manifests, CI and infra
remain E-owned. The current task expires the old W01 cross-owner bootstrap lease;
stale conditional registry wording does not revive it. No product source,
migration, runtime, provider call, financial operation or remote approval is
created by this proposal.

## 1. Current entry truth and actual request path

`architecture/parallel-contract-release.json` remains W01 `INTEGRATION_PENDING`:
`BASE_W02` is null; W03/W04/W05 bases are absent; accepted business contracts and
clients are empty; next-release source/review and published versions are unset.
The present `contracts`/`event-contracts` packages are `0.0.2`, and `api-clients`
is `0.0.1` with an empty export. Those are existing package versions, not W05
financial releases. Merged B/C/D/E W04→W05 requests remain proposed/unaccepted.

| Actual boundary | Observed source and limitation |
| --- | --- |
| Admin | `apps/admin-web/src/index.ts` only marks `foundation-only` and `businessReady:false`; it calls no business client. Registered payment/wallet prototype controls do not provide persisted search, proof review, refund or settlement actions |
| Billing / Wallet | Both Prisma schemas have only `ServiceMarker`; Billing retains `20260920000000_sprint_02_foundation`, Wallet `20261005060000_w01_foundation`. No payment, proof, refund allowance, receipt, journal, custody, settlement or financial operation tables/controllers exist |
| Media / Booking | Each schema has only `ServiceMarker` and the original foundation migration. No private proof binding/scan/access runtime or persisted cancellation/reschedule saga exists |
| Pure helpers | `services/billing/src/domain/ledger.ts` validates a candidate balanced journal; `services/booking/src/domain/lifecycle.ts` checks a historical transition table/version. Neither posts/authorizes money, reserves capacity, verifies payment or implements cancellation/rescheduling |
| D services | Reporting has Inbox/`ProbeProjection`; Communications has Inbox/`ProbeNotification`. Both workers parse foundation probe events only, and both app modules keep business readiness false. Product checkpoints/audit exports/delivery attempts/conversations are absent |
| Existing auth | `services/identity/src/domain/auth-policy.ts` grants Finance `billing.read` and `billing.refund`; Operations has `operations.dispatch`, Support its case grants and reviewer `verification.review`. These grants exist; finer payment-review/verify/private-proof/approve/settlement/export profiles are unpublished |
| Shared surfaces | HTTP registry lists Identity foundation/Gateway routing; event registry lists the foundation probe and strict Booking-confirmed contract-only event. No accepted W05 producer/parser/client or business broker bindings are supplied |

The current **routing-only** trace for the two financial entries is:

| Current public route | Gateway behavior → intended owner | W05 gap |
| --- | --- | --- |
| `GET /api/v1/admin/billing` | `admin.billing`, `billing.read` → `/internal/v1/billing/summary` | Billing has no real summary provider; no accepted payment search/detail/review queue or authoritative reconciliation schema |
| `POST /api/v1/admin/billing/:id/refund` | `admin.refund`, `billing.refund`, required idempotency header → `/internal/v1/billing/:id/refund` | Owner has no durable refund/reservation/provider implementation. Route presence does not prove amount validation, object scope, policy, replay receipt or returned money |

`packages/contracts/src/gateway.ts` has no payment-proof, verification,
settlement, private Media, Wallet, cancellation/reschedule or operation-recovery
routes; `GatewayOwner` excludes Media and Wallet. `apps/api-gateway/src/domain/policy.ts`
rejects query strings, so paginated financial search cannot be assumed supported.
It validates the existing key alphabet `[A-Za-z0-9_-]{16,128}` but stores no replay
result. E must publish compatible bounded query/route/client/error changes.

`GatewayService` authenticates unsafe requests, checks configured origin/CSRF and
route permission, and forwards verified credentials/context. It is transport,
not the financial authority. B/C must independently verify current audience,
object/market/purpose, actor versus beneficiary, session/auth revision and expected
owner revisions. Caller-written role/subject/merchant/status fields confer no
authority. Existing broad `billing.refund` and Workforce `verification.review`
must not silently become proof verification or treasury approval.

`BoundedHttpClient` makes one attempt with configured timeout (default 3 seconds).
A locally aborted request may already have committed at B/C. Current owner 409/422
errors lose domain detail through coarse mappings, and owner 503/504 become 502;
local timeout has `UPSTREAM_TIMEOUT`. E must preserve safe pending/unknown,
operation/phase/reason/recovery semantics without exposing provider exceptions.
No UI retry may substitute a new business key to bypass uncertain money movement.

## 2. Contract/policy freeze before dependent D writes

All field sets below are semantic review requirements, not new accepted DTOs,
endpoints, versions or live IDs. E and actual providers/consumers must freeze:

- Typed owner-issued resource/operation/evidence refs and **named per-owner**
  expected revisions; keep event aggregate versions separate from opaque policy
  revisions. Existing UUID validators do not settle every new owner ID profile.
- Exact lossless Money, currency/scale/policy, bounds and permitted signed
  correction directions. B uses `amountMinor/currencyPolicyRevision`; older C/D
  profiles differ and E's W04 request adds `precision`. Publish one wire shape or
  reviewed adapters, without float conversion, default exponent or mixed-currency
  totals. Pure helper limits are not approved accounting policy.
- Closed discriminated request/result/event schemas, required/nullable fields,
  parser/client exports, schema major, bounded arrays/queries and fieldsets.
  Unknown states/majors cannot be interpreted as success. Preserve strict existing
  Identity/Gateway/Booking compatibility; a breaking dependency needs a reviewed
  release and new common base.
- Current submit/review/verify/refund-request/reserve/approve/execute/reconcile,
  treasury and export grants, scoped beneficiary/guest/service delegation,
  independent maker/checker rules, approval limits and required reasons. Existing
  grants remain versioned inputs; do not invent finer permissions already deployed.
- Actual fee, cutoff, partial/overpayment, refundable cap, cash-return method,
  late-credit, reschedule price difference, custody holder/purpose, accounting
  trigger/finality and retention/legal-hold policy. Configuration publishes
  reviewed typed policy with B/C applicability validation; it owns no money state.
- Server UTC instants, provider occurrence/observation/commit times, appointment
  market timezone, expiry/skew/deadline/retry/replay/tombstone and source repair
  windows. No unaccepted numerical timeout, fee or retention default is selected.

For each mutation, scope the key to owner/contract major, verified initiating
actor and delegation, operation and business target. Fingerprint beneficiary,
Money/method/merchant/policy, all meaningful expected revisions, proof/evidence
refs/hash, reason/approval and compensation identity; E/owners freeze normalization
and set/order semantics. Exclude credentials, CSRF, signed capabilities and trace
IDs. Same key/fingerprint returns the durable authorized receipt; changed payload
conflicts. Independent permanent business uniqueness prevents a second effect
after replay-cache expiry or a new-key duplicate. Status reads recheck authority
without triggering execution. Unknown outcome looks up the original operation.

## 3. Proof review is separate from money verification

Trace the future proof path through accepted E clients/routes to **B's durable
review/financial authority**, with **C's private Media authority**, rather than
adding a local admin payment state:

1. B supplies a narrow real payment/obligation/beneficiary/proof-purpose binding
   without requiring Media or a completed review screen. C then accepts that
   binding for reserve/upload/scan/process/finalize/access. B's proof consumer
   follows the merged real Media provider; this breaks the binding↔Media cycle.
2. Preserve the approved intake rule: valid nonempty transaction hint **or** an
   authorized processed image, or both. Hint-only intake must not require a
   fabricated Media object. Image-only intake must prove actual object/version,
   current purpose and scan/finalization. Exact hint normalization, duplicate and
   replacement rules require compatible schema review.
3. B persists submission/review-case IDs/revisions, policy, server received time,
   operation and audit. A simultaneous review claim/decision needs owner CAS and
   independent current reviewer scope. Request-correction/reject/continue-review
   changes the review fact, never erases independently verified money.
4. Independent verification uses genuine authorized merchant/provider/bank
   evidence: provider/recipient merchant, external transaction identity,
   immutable evidence/version/hash/protocol provenance, credit direction,
   finality, exact amount/currency/beneficiary matching and occurrence/observation
   times. Customer evidence, a return URL, scan success and an admin click cannot
   alone establish received funds. A manual merchant-evidence route requires its
   own approved access/provenance/matching/separation workflow.

B's W04 `W05-B-04` distinguishes **received merchant credit** from **allocation
to an obligation**. Independently established genuine credit to the approved
recipient survives amount/reference/Booking allocation mismatch as an immutable
unallocated/disputed financial fact; it is not automatically obligation-paid or
Work-eligible. Unproven signature/merchant/finality cannot establish that credit.
Do not discard real money to make the Booking state look consistent or invent
a suspense account/automatic refund. Journal classification and remediation
remain B policy. Merchant-scoped uniqueness `(provider, recipient merchant,
external transaction ID)` prevents the same credit being allocated twice;
split allocation needs explicit policy. Genuine independent verification need
not require a customer's proof image when the accepted protocol supplies evidence.

The private viewer requests the exact object/version and finance-review purpose,
with current B case/binding and E/C object authority at read/download, not just
at page load. Expired/revoked/foreign/quarantined/deleted/wrong-purpose objects are
denied with an authorized positive control. Scope the capability to approved
content and expiry; choose protected retrieval or documented short-lived access
through E/C. Never persist proof contents, transaction hints, account data or
signed capabilities in browser storage, address/query/history, generic events,
logs or Reporting exports. Audit actual access without copying document contents.
Review permission does not imply upload, merchant-history or verification rights.

## 4. Refunds, partial allowance and unknown execution

Consume B's proposed W05-B-06 reserve → W05-B-07 provider operation/status →
W05-B-08 independent resolution after those providers are accepted. D owns
request/status presentation only; Support's decision/request is not execution or
financial confirmation. The request binds original verified payment/allocation/
receipt, expected revisions, positive exact Money, stable refund business ID,
reason/policy and required decision/approval/evidence refs. Destination derives
from the accepted original-payment/refund protocol, never arbitrary browser data.

For each payment/currency, Billing transactionally enforces:

`confirmed refunds + active reserved/in-flight/unknown refunds <= approved refundable cap`.

The cap and fee/cash-return treatment require approved policy; it is not assumed
equal to every collected unit. Competing valid partial requests reserve only
remaining allowance. Repeated business identity with a different key cannot
reserve again; altered fingerprint conflicts. Preserve exact original, confirmed,
reserved and residual Money/ref relationships, rather than overwriting the payment.

| Authoritative result | Required D behavior / B-owned consequence |
| --- | --- |
| Requested/reserved/approved | Show refund ID/revision, requested/reserved amount, independent approval and original payment refs; no refunded success |
| Not sent / documented pending | Show durable phase and permitted next action; cancel a reservation only when B proves no external effect started |
| Provider request accepted or response lost | Pending/unknown, same provider operation/query identity; allowance remains reserved. Do not resend with a new key or free allowance on timeout/age |
| Independently confirmed | Show exact confirmed amount and immutable refund receipt/linked reversal postings; B atomically consumes allowance and commits receipt/audit/outbox |
| Independently proven terminal failure | Show safe final reason; B releases reservation once under documented finality, without a fictitious reversal |
| Contradictory late evidence | Owned quarantine/reconciliation state; never second debit or optimistic allowance release |

Crashes around local reservation, provider dispatch, callback and finalization
must recover the same operation. Provider idempotency/query/callback capabilities
must be documented, not assumed. Unknown without safe provider recovery remains
durable pending with the approved manual escalation owner. Partial financial
completion remains visible; no accepted refund receipt means no executed refund.

## 5. Cancellation/rescheduling are now required W05 gates

Unlike the W04 reservation packets, **W05-D must activate and prove actual admin
cancel and reschedule against real C/B owners after entry is accepted**. These
are current-wave acceptance requirements, currently BLOCKED, not deferred merely
because earlier documents called them future. No action is executed in this child.

C Booking owns the durable intent/saga; Scheduling owns hold/replace/release,
Dispatch owns assignment quiescence/release and B owns assessment/amendment/refund/
custody consequences. Expected Booking, Work, assignment, reservation, quote,
obligation/payment and policy revisions are distinct. Current actor/beneficiary,
execution safety, cutoffs/reasons/fees and exact replacement consent are owner
checks. A Reporting row, historical assignment or a single preflight HTTP read
cannot fence an in-flight start/reassign/cancel race; C must accept conditional
execution authority/quiescence and current revision semantics.

| W05 trigger | Independent authoritative progress and required recovery |
| --- | --- |
| Cancel accepted, resources released, refund fails/is unknown | Keep C cancellation/release facts; show B refund/compensation pending or failed with exact owner operation. Do not restore Booking or label money refunded to hide partial progress |
| Cancel versus start/delivery/reassign/another admin | Owner-defined one-winner revision/fence and safe in-flight policy; explicit refused/pending/quiescing outcome. Completed Work/cash/settlement history survives later allowed financial correction |
| Reschedule alternative slot unavailable/expired/competing | Preserve old/new reservation and immutable quote/appointment history under the accepted acquire/commit/release protocol; expose capacity conflict. Never silently lose the old valid slot or claim the alternative committed |
| Replacement capacity changed, financial amendment unknown | Display actual old/new capacity/Booking outcome and separate B amount/fee/compensation phase. C resumes its durable recorded protocol; no optimistic peer rollback or hidden local price edit |
| Late verified credit after cancellation/expiry | Preserve B received credit and C expired/released facts; create only approved compensation/reacquire/refund workflow with distinct identity. Money never resurrects expired capacity/assignment automatically |

Freeze whether the protocol retains old capacity until new acceptance, how it
fences old/new assignment and quote/obligation changes, and which failures require
release/reacquire/manual recovery. Separate local atomic commits from network
orchestration; there is no cross-service atomic swap. Every compensation has a
stable child identity/key, exact owner result, due/retry/exhaustion status and
auditable escalation. Historical snapshots and customer consent remain immutable.

The convergence oracle starts from durable C/B command receipts and expected
causal refs/revisions, then checks: exact reservation ownership/release and no
overlap; current assignment/Work fence; Booking desired/actual operation state;
Billing obligation/received/allocated/refund Money and postings; Wallet custody
links; all three apps' authorized views and D applied source vector. Capacity
convergence and financial convergence are separate assertions. Unknown/pending
financial compensation cannot make a released slot occupied again, and a
financial receipt cannot hide a missing release. Product eligibility and accepted
deadline bounds are prerequisite inputs; no wall-clock event order/global version
or unreviewed longer timeout closes the gate.

## 6. Settlement, correction and independent financial reads

Search/detail/reconciliation/refund/settlement views show actual B operation IDs,
resource revisions, exact amounts/currency/policy, source evaluated time and
explicit pending/unknown/rejected/discrepancy state. Missing sources remain
unavailable, never zero, unpaid or settled. Sensitive actions query current B/C
authority and revisions again; a stale dashboard cannot approve money.

Collection, custody handover and independent treasury acceptance remain separate.
Wallet reports approved holder/purpose/recipient and per-receipt allocations /
residuals against immutable Billing receipt/posting refs. B treasury creates its
own authoritative evidence/settlement; Wallet settles only after reconciled B
facts. Cash receipt, handover and treasury movement are not three revenue entries
or technician earnings. Wrong actor/self acceptance, amount/currency mismatch or
missing treasury evidence cannot produce settled success.

D's W04 W05-D-09/10 request linked Billing settlement corrections then Wallet
custody reconciliation: stable correction business identity, original settlement/
receipt/posting/handover/allocations, named expected revisions, exact affected/
declared/observed/residual Money, independent actor/evidence/approval/reason/policy.
B closes typed pending/mismatch/rejected/corrected results and the coordinator
order. Append immutable linked reversals/replacements, never edit old postings.
Refund/reversal/correction/acceptance races preserve one authoritative effect and
pending reconciliation. No D code writes B/C databases or locally toggles paid,
refunded, cancelled, rescheduled or settled flags.

## 7. D events, freshness, sensitive audit and export initiation

E/B/C must accept precise event names/versions, closed data/nullability and
authenticated publication before D consumes them. `payment-verified` versus
catalog `payment-confirmed` is unresolved; proof-reviewed cannot alias either.
Required data is safe owner/payment/review/refund/Booking/operation refs, named
source revisions, policy/causation/time, approved Money and receipt/posting links.
Financial proof, hints, contacts, merchant/account secrets and signed URLs stay
outside generic events. Ref-only events require scoped immutable owner snapshots,
retained replay/correction windows and actual B reconciliation reads.

Reporting requires generation/schema, per-projection contribution identity,
per-owner contiguous aggregate checkpoints, bounded gap/repair records, coverage
and limited audit provenance. Inbox, effects and checkpoints commit before ACK.
Duplicate bytes do not count twice; altered identity bytes conflict; old revisions
do not regress; refund-first/reversal-first/gaps remain partial until authorized
source repair. Corrections replace the affected contribution once. Rebuild uses a
fenced generation and includes correction/redaction history; it sends no financial
command or notification. Broker tag/last event time cannot establish completeness.
Expose source vector/as-of/availability and policy-bound freshness; quiet sources
need accepted watermark/snapshot coverage. B remains authoritative.

Each sensitive **owner** decision audit commits with its operation/state/audit/
outbox: initiating actor and beneficiary separately, current grant/delegation/
market/purpose, reason/policy/approval/evidence provenance, original refs, exact
Money and before/after revision, outcome and server time. D records its owned
access/export/notification/projection operations and references B/C audit IDs;
it never substitutes a browser click log for B's financial audit. Revocation and
failed authorization must be evidenced without leaking proof or provider secrets.

**Export initiation is an explicit W05-D requirement**, even when the financial
report is stale or generation is later blocked. After current export/fieldset/
purpose/market authority, D Reporting persists a stable export operation/job,
scope-bound query/period/timezone, allowed fieldset/format, reason/policy,
requested source generation/checkpoints, actor, server time, audit and replay
receipt in one owned transaction. Exact export grant, approved scope/formats,
state schema, retention and partial/stale-export policy need E/product review.
Unauthorized or invalid requests are denied/audited under the accepted policy;
they do not create an authorized export job. Response loss recovers the same job.

Initiated/queued is not a generated/downloadable file. Require real private Media
finalization and approved readiness before showing ready; recheck authorization
at worker/release/download, with expiry/revocation and partial-object cleanup.
Audit actual generation/download separately with final generation/coverage,
row count/checksum and result. Exclude proof images/hints, bank/account/QR secrets,
credentials, precise tracking, conversations and unrestricted identity documents.
Any approved CSV/PDF artifact needs content safety and its own acceptance; an
export button or a locally generated prototype summary is no evidence of it.
Do not expand export initiation into unspecified additional reports or recipient
delivery. No export implementation or file generation happens here.

Communications follows accepted source→template/version→purpose→current recipient
mapping for review/correction/refund/cancel/reschedule/settlement outcomes. It
persists intent/attempt/due/retry/audit before delivery, handles supersession and
current participant/object revocation, and checks permission before send/read/
subscribe/reconnect. Cancellation revokes the relevant operator purpose under
C's contract; it does not automatically erase the customer's authorized payment
history. Provider accepted, independently observed delivered, browser receipt
and user read are different facts. Ambiguous send stays unknown/reconciles;
source replay/rebuild never sends again. No email/SMS/push/WhatsApp capability is
inferred from Identity OTP or the financial provider. Actual channel policy,
callbacks/retry/expiry and independent outcome evidence remain prerequisites.

## 8. INT-D-01 and actual transport adoption risks

At this source, both `services/{communications,reporting}/src/inbox/prisma-inbox.store.ts`
still catch **any** transaction `P2002`/`23505` and return `DUPLICATE`.
`packages/platform-messaging/src/inbox-consumer.ts` ACKs it. The normal existing-row
hash comparison does not protect a concurrent absent-row race or an unrelated
effect unique failure. This is an unresolved **static** integrity/data-loss risk,
not a reproduced W05 runtime failure or a fix supplied here.

D must later restrict known Inbox uniqueness handling and, after rollback, read
the committed winner/hash in a fresh transaction: matching winner permits
duplicate; changed hash conflicts; absent winner/unrelated effect error is not a
success ACK. Accepted consumer/producer namespace changes require E compatibility
review. Real two-transaction controls for both services must prove same-ID/same-
hash positive dedup, same-ID/different-hash integrity rejection and unrelated
effect-unique rollback without Inbox/checkpoint/effect. Existing integration Case
C2 waits for original worker exit before altered bytes; mock outcome unit tests
cannot close these races.

Current broker topology/ACLs cover Catalog probe only. E/owners must provision and
verify every accepted durable business binding before producer activation,
including stopped-subscriber catch-up, partial-binding failure, bounded retry,
DLQ transfer/outage/replay and immutable authenticated recovery. Positive confirm
and mandatory publication do not prove every intended subscriber or delivery.
E W04's defect ledger also retains producer Outbox exhaustion, listener lifecycle,
confirm→finalize crash and harness cancellation/deadline risks; source-owner fixes
and actual source-bound reruns are required before adoption.

## 9. Proposed child split and current-wave acceptance

All children remain **BLOCKED / NOT RUN** pending actual accepted entry and
allocated resources. No moving peer branch, private DTO or fixture becomes a
production dependency or integration result.

| Child / writer | Narrow real prerequisite/provider boundary | Gate before its later consumer |
| --- | --- | --- |
| E prerequisite release + owners | Actual predecessor cash/Booking/capacity/guest acceptance, BASE_W05, reviewed policy/grants/clients/routes/errors and provider dossier | Source-bound release/compatibility/resource evidence; no documentation-only base |
| B financial binding / C narrow lifecycle authority | B payment/proof binding and read/operation facts independent of Media; C current Booking/assignment/capacity/cancel assessment authority independent of future full refund saga | Real owned DB/HTTP/current Identity/object/revision/idempotency constraints; first provider does not wait for its future screen |
| C private proof provider | Consumes real B binding, implements private bytes/scan/finalize/current access | Real Media/storage/scanner/expiry/revocation and positive/negative authorized controls |
| B verification/refund providers | Proof review consumes accepted Media; genuine independent verification and partial refund reservation/execution/resolution consume documented evidence/current policy | Owned transactions/constraints/independent authority; test-supported provider protocol and uncertain-result recovery, not fake verified responses |
| C cancel/reschedule coordinator and B custody correction | Consumes accepted narrow Scheduling/Dispatch/financial assessment/refund primitives; B Wallet follows authoritative Billing correction | Real owner compensation/race/restart and exact independent capacity/financial convergence before admin app gate |
| D supporting consumers | Reporting events/checkpoints/reconciliation/audit-export initiation and Communications intent/history/delivery against real producers/current authority | INT-D-01 controls, scope/fieldsets/freshness/replay/privacy and durable operation proof. Delivery success does not gate B's transaction |
| D admin + A/C consumers / E combined barrier | Accepted providers and exact approved production/recovery states | Actual payments/review/private proof/refund/settlement plus cancel/reschedule journeys, customer/operator updates, current-source mandatory and resulting-target gates |

If B needs C eligibility while C needs B financial assessment, freeze/accept each
owner's narrow authoritative read/binding first; only their orchestration
consumers require both. Likewise Billing correction precedes Wallet reconciliation,
and D enqueue/read provider can be accepted before its full financial-event
integration gate. Do not require Notifications/Reporting caught up or a full
three-app journey to commit/accept the first financial provider. The parent remains
integration-pending until all task-listed integrated scenarios pass together.

Required W05 proof includes Finance positive controls with Operations/Support
denied, tampered direct requests, amount/currency/merchant mismatch, expired/
revoked proof/session, simultaneous reviewers and key/business replay; genuine
documented test-provider success/failure/duplicate callback/lost response/delayed
settlement; approved partial refund races and compensation retry; actual admin
cancel/reschedule with competing revision, alternative-slot failure, late money
and partial compensation; exact customer/operator/capacity/financial convergence;
sensitive audit and export initiation; source reorder/hash/gap/restart/freshness.
Owned DB migration/upgrade/privilege and real broker/storage/HTTP/Identity/browser
evidence are distinct from domain/unit/contract fixtures. Approved RTL/English/
new production states and pinned Linux reference/candidate/diff plus separate
Windows/device evidence are still required, without changing references.

The repository supplies existing foundation scripts, not a runnable W05 gate:
admin `build`, `typecheck`, `test:runtime`; Reporting/Communications `generate`,
`build`, `build:tests`, `typecheck`, `migrate:deploy`, `start`; root `test:nest`,
`test:contracts`, `test:integration`, `check:migrations`, `acceptance:preflight`,
`acceptance:run`. No such runtime/test command was executed by this child. E must
register actual affected commands and allocation; do not invent a script or label
foundation boot tests financial acceptance.

## 10. Provider evidence, open decisions and next handoff

B W01 `PROVIDER_ACCEPTANCE.md` and B W04's provider-dossier section remain
`DOCUMENTATION_AND_ACCESS_PENDING`; their limited historical public research is
not fresh merchant/protocol/sandbox acceptance. This source has no financial
adapter, accepted merchant/account reference, authenticated official verification
or partial-refund protocol, sandbox allocation/result or production readiness
record. **Sandbox availability and actual provider capabilities remain unverified**.
No unofficial SDK, OCR, wallet automation or invented provider endpoint closes it.

Authorized owners must obtain genuine official protocol URL/version/retrieval
date and merchant/test-environment authority; region/currency/amount encoding;
auth/signature/key rotation; recipient/direction/finality/status/reversal;
idempotency/query/callback/replay; full/partial refund and reconciliation evidence.
Credentials/actual account numbers stay outside source. Where only an approved
manual merchant-history route is available, document provenance/verification,
approval separation and test evidence; do not call it a sandbox/API. Required
test-provider cases remain blocked until a real permitted route exists. Production
payment/refund execution is not a W05 test prerequisite and is not authorized here.

Preserve Cash, ShamCash and Syriatel Cash and accepted `sham`/`shamcash` mapping
only after publication. Paymera necessity and its relationship to those methods
remain an explicit owner/provider decision: no invented fourth method or silent
omission. Internal staff/team cash custody does not grant customer stored value,
withdrawal, marketplace, payroll, provider payout or recurring-debit scope.

Review inputs: current W05-D attachment, AGENTS/design lock/ADR/F010 authorities;
F001 service catalog and exclusive ownership ADR; actual source paths above;
`B/W04/W05_CONTRACT_PACKET.md` W05-B-01..10 and received-credit/refund/provider
sections; `C/W04/W05_CONTRACT_REQUESTS.md`; `D/W04/W05_CONTRACT_REQUESTS.md`;
`E/W04/W05_CONTRACT_REQUESTS.md`, provider sequence and defect ledger. Old W04
labels/observations cannot replace this wave's source or current acceptance scope.

W06 requests for Support resolution↔refund linkage, verified Reviews eligibility,
notification consent/templates/conversation scope and approved Wallet/Subscription
admin operations are next-wave proposals only. Supply owner refs/revisions,
authorized recovery/status, compensation and compatibility to E/A/B/C before
their barrier; do not implement them automatically in W05. All missing policy,
provider, design, predecessor and real integration evidence remains an explicit
blocker, never a skipped successful case. This plan grants no approval, merge,
live money, provider operation or deployment.
