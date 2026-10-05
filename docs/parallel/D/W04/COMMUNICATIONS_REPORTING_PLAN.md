# W04-D Communications and Reporting provider plan

Status: **LANE-LOCAL PROPOSAL / UNACCEPTED / RUNTIME NOT STARTED**.
Observed source: `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`.
This SHA is provenance, not `BASE_W04`. No endpoint, package version, policy,
provider capability, broker topology or production state is accepted here.

The current W04-D task supersedes historical bootstrap wording: the W01 E
cross-owner technical bootstrap lease is expired. E remains the permanent writer
of shared packages, manifests, root configuration, CI and infrastructure. D owns
its application/service implementation and lane-local proposals; this child
changes only this document. The stale ownership/release registries need E's
reviewed transition, not a renewed implicit bootstrap permission.

## 1. Source truth and entry dependency

`architecture/parallel-contract-release.json` still records W01
`INTEGRATION_PENDING`, `BASE_W02: null`, no `BASE_W03`/`BASE_W04`, an empty
`acceptedNextWaveContracts`, no accepted client and no next-release source or
package versions. Merged B/C/D/E W03 packets are reviewable proposals, not a
semantic contract release. `packages/api-clients/src/index.ts` still exports no
clients. `packages/contracts/src/registry.ts` registers Identity foundation and
Gateway routing only; `packages/event-contracts/src/registry.ts` registers the
foundation probe runtime and strict `booking.confirmed.v1` contract-only shape.
Neither registry publishes these W04 operations.

Before dependent implementation, E and affected owners must publish the actual
immutable entry base, reviewed schemas/parsers/clients and compatibility matrix,
current account/guest/delegated-service and object grants, approved policy refs,
source snapshots/replay windows, safe error/recovery mappings and isolated
resources/gate allocation. Freeze exact ID/revision scalars, required/nullable
fields, bounds, closed enums, money/precision, UTC/local-time semantics,
idempotency scope/fingerprint/replay/tombstone lifetimes, retry/deadline/expiry
budgets and correction ownership. Missing inputs block the affected write;
observing a newer main or merging this file supplies none of them.

Known vocabulary differences remain explicit: B's `amountMinor` plus currency
policy revision, C's `minorUnits`, and D's older explicit exponent/policy version;
account/guest versus customer/guest beneficiaries; opaque versus numeric owner
revisions; and financial event names. E/owners must accept one wire vocabulary
or reviewed lossless adapters. Do not widen existing strict V1 schemas privately.

## 2. Actual Communications and Reporting foundation

| Surface | Actual source at the observed SHA | W04 delta requiring its own proof |
| --- | --- | --- |
| Communications persistence | `services/communications/prisma/schema.prisma` has only `ServiceMarker`, `InboxMessage`, `ProbeNotification`; the sole migration is `20260920000000_sprint_02_foundation` | Owned notifications, delivery attempts, conversations, messages, membership/read cursors, idempotency/audit/outbox and matching migrations are absent |
| Reporting persistence | `services/reporting/prisma/schema.prisma` has only `ServiceMarker`, `InboxMessage`, `ProbeProjection`; the same foundation migration identity | Product projections, contribution identities, generations, consumer checkpoints and audit projections are absent |
| Workers | Both `src/inbox/consumer.runner.ts` parse only `parseFoundationProbeCreatedV1` and upsert a probe effect with observable `applyCount` | No Booking/assignment/Work/collection/custody/settlement ingestion, send scheduler, callback reconciliation or membership revocation processing |
| Application readiness | Both `src/app.module.ts` set `BUSINESS_READY = false` and provide Prisma/Inbox/health; declared `postgresProbe` is not supplied to the health module | No business controllers/use cases or readiness evidence; a healthy process cannot become delivery/financial acceptance |
| Inbox | Both `src/inbox/prisma-inbox.store.ts` write event ID/hash and local effect in one Prisma transaction | INT-D-01 below remains unresolved; no business checkpoint or generation semantics |
| Outbox transport | `packages/platform-messaging/src/outbox-relay.ts` and `publisher.ts` provide technical lease/confirm/mandatory publication. Catalog owns the actual probe Outbox store | Neither D service has a product Outbox table/store/relay. The shared technical relay is not a delivery provider or business retry policy |
| Broker | `packages/platform-messaging/src/topology.ts` defines `catalog.events`, separate Communications/Reporting probe quorum queues, delivery limit 3 and service DLX/DLQ. `infra/rabbitmq/acceptance-bootstrap.sh` grants these subscribers read of Catalog only | Business producer/subscriber namespaces, ACLs, durable bindings, scheduled retries, explicit DLQ transfer/replay and source-history recovery need E/owner acceptance |
| Source providers | Booking, Dispatch, Workforce, Media, Billing and Wallet Prisma schemas contain only `ServiceMarker` | Proposal refs cannot establish actual assignment authority, private evidence, collection, treasury or settlement facts |

`architecture/service-catalog.json` allocates Communications
`notifications`, `delivery_attempts`, `conversations`, `messages`, and Reporting
`projections`, `consumer_checkpoints`, `audit_projections`; their business API/event
status remains `planned-not-implemented`. The architecture's persistence,
revocation, Socket/reconnect and independent money requirements are targets,
not evidence of implemented models.

Existing technical defaults are foundation observations only: relay lease
30 seconds, batch 20, maximum 5 attempts, confirm timeout 10 seconds; probe
consumer reconnect delay 200 ms to 5 seconds. The reconnect loop itself continues
until cancellation. These values do not select W04 provider retry/expiry policy.
Broker redelivery is not a delayed external-send schedule.

## 3. INT-D-01: static integrity defect, not an executed failure

Both service-local stores first compare a found Inbox row's byte hash and return
`CONFLICT` for changed bytes. Their catch then classifies **every** Prisma `P2002`
or PostgreSQL `23505` anywhere in the transaction as `DUPLICATE`, without checking
the failing constraint or reading the winning Inbox/hash. The shared
`packages/platform-messaging/src/inbox-consumer.ts` ACKs `DUPLICATE`.

Two concurrent transactions can both read no Inbox row; the losing insertion may
represent the same event ID with different bytes. An unrelated projection,
notification or message uniqueness failure can also roll back the transaction
and be incorrectly returned as duplicate success. This is a static risk of
conflict suppression or discarded work. No concurrent failure was reproduced
in this documentation child, and it is not fixed by describing intended semantics.

Required D-owned correction proposal: identify only the accepted Inbox uniqueness
constraint; after rollback, read the committed winning Inbox in a fresh
transaction and compare the authenticated event identity and exact byte hash.
Return duplicate only on a proven matching winner; differing hash is integrity
conflict. Missing winner or unrelated uniqueness failure remains an error under
the accepted bounded recovery policy, never a duplicate ACK. If multiple logical
consumers/producers require namespaced Inbox identities, E/owners must first
accept that migration/compatibility decision; do not silently change the probe
contract or catch all business-uniqueness errors as delivery deduplication.

Required real PostgreSQL/consumer controls for **both** services: concurrent
same-ID/same-hash has one effect and a legitimate duplicate; concurrent
same-ID/different-hash has one effect and one integrity conflict/DLQ; an unrelated
effect unique failure rolls back Inbox/effect/checkpoint and is not ACKed as
duplicate. Crash before commit and after commit before ACK prove atomicity and
redelivery. `tests/integration/outbox-inbox.test.mjs` Case C2 is sequential: it
waits for the original Reporting consumer to exit before publishing changed
bytes. `tests/unit/messaging.test.mjs` uses fake Inbox outcomes. Neither closes
these races or unrelated-constraint cases.

## 4. Bounded provider-first children without a full-flow cycle

All rows below are proposed boundaries after accepted entry; no new script,
runtime, migration or API is activated here. Each owner proves its own real
database/HTTP/authorization boundary before its future app consumer is required.

| Order | Bounded producer/provider child and prerequisite | What can follow without a cycle |
| --- | --- | --- |
| 0 — E + owners | Accept exact contracts, policy, identities, clients, error/unknown-outcome mappings and durable subscription topology before business publication | Owned provider children consume stable published contracts, not moving peer branches |
| 1 — C with E/A | Real narrow Booking/assignment binding, current participant/beneficiary/object authority and direct authorization reads. Dispatch owns assignment facts; current grants and revocation are independently testable | Media Work-purpose reservation/finalization can depend on a real binding; full Work execution follows its accepted owner decision. D need not wait for completed Work or cash settlement to implement scoped conversation/intent providers |
| 2 — D | Durable Communications intent/history/current membership/read provider against real narrow C/E authority; freeze Reporting read/coverage contract and accepted D clients | B/C can emit approved intents or source events against the accepted D interface without requiring the future complete cash journey. External channels remain unavailable unless separately configured and proven |
| 3 — C/B | C's actual authorized Work/evidence producer follows binding → Media purpose → full execution. B cash/treasury providers consume the applicable current C authority; minimal Wallet custody follows Billing's authoritative settlement contract | B's owned cash/custody transaction and outbox can commit while delivery is pending/unavailable. Notification success and Reporting catch-up cannot be prerequisites for creating the financial receipt. B integration may use accepted D clients without waiting for D's full finance-consumer gate |
| 4 — D | Consume actual C/B business producers; implement Reporting effects/checkpoints/reconciliation and the accepted source-to-notification matrix | Finance/assignment notifications and admin views gain real producer proof. Their gates now include B/C events/reads, rather than requiring B to pass them before B exists |
| 5 — A/C/D + E | Wire the three apps against merged providers, then run the serialized combined-source and resulting-target evidence | Full cash journey, recovery, independent totals and exact approved UI states can be accepted at their real source SHA |

Distinguish a Communications **enqueue/history provider gate** from its later
**B/C business-event integration gate**. Similarly, publishing the Reporting read
contract does not claim the money projections exist before B. Do not require
delivery before committing a source operation or require an app journey before
accepting its first provider. Each source owner persists its own intent/audit/
outbox; D persists its own consumed intent. No distributed DB rollback or
cross-owner Prisma import is introduced.

The W04 attachment explicitly assigns live location snapshots to **Workforce/C**:
source update time, accuracy and stale/offline/availability are required. Older
unaccepted Booking-owned tracking proposals require a recorded reconciliation;
D must consume Workforce, not create a competing tracking history. **Work
execution ownership remains unresolved** across historical/proposed allocations;
E/C must record the accepted owner, binding/revision/grant contract before D uses
execution facts. This plan does not invent a new Work service or move execution
ownership to Workforce simply because Workforce supplies positions.

## 5. Communications owned transaction and authority requirements

Proposed model semantics below are requirements to freeze, not existing Prisma
models or accepted names/versions:

For each D mutation, proposed key scope is owner/contract major, verified
initiating actor plus service/delegation binding, operation and target/business
identity. Fingerprint every meaningful source/expected revision, recipient,
purpose, pinned template/channel, text/evidence refs and policy/expiry assertion;
exclude secrets and transport trace/request IDs. E/owners must freeze canonical
array/text normalization and bounds. Same key/fingerprint returns the original
receipt after current authorization; changed bytes conflict. Durable business
uniqueness survives replay-cache expiry. A lost response queries the same
authorized operation rather than creating a replacement message/send identity.
Exact retention/expiry and safe concurrent-pending behavior remain unaccepted.

| Local record | Required identity, concurrency and privacy semantics |
| --- | --- |
| Notification intent | Stable logical notification ID; source owner/event/ref/revision; recipient authority ref; transactional purpose; pinned template/version; allowed channel; bounded typed parameters; policy/consent ref where applicable; expiry; local revision; command receipt/audit. Business uniqueness binds source, recipient, purpose, channel and pinned template version; template edits cannot resend the same intent silently |
| Delivery attempt | Notification/generation/attempt identity; provider request/idempotency ref where documented; durable due time, attempt count, lease/fence, timestamps and safe outcome/error refs. Preserve ambiguous submission and reconciliation state across crash/restart; replacement worker cannot overwrite a newer lease result |
| Verified callback/result | Accepted provider identity and documented verification method; provider callback/request identity, exact payload hash and safe observed/received times; notification/attempt mapping. Persist accepted callback dedup, attempt transition, audit and delivery-update Outbox together. Reject spoofed, foreign, replay-conflicting or uncorrelated callbacks; reordered observations cannot regress established facts |
| Conversation/membership | Stable conversation/Booking binding; authoritative beneficiary/current assignment/support scope; source revisions and membership epoch; allowed history boundary/retention. Client account, contact, booking ID or room name never chooses membership |
| Message/read cursor | Stable actor/conversation command identity and fingerprint; server-assigned ordered sequence with database uniqueness; plain bounded text and purpose-scoped finalized Media refs. Concurrent sends serialize sequence allocation. Participant read-through cursor is monotonic and cannot exceed that participant's authorized visible sequence |
| Inbox/audit/Outbox | Source delivery bytes/hash and scoped processing identity; intent/message/membership effects and local audit/Outbox in the same owned transaction before ACK. Outbox contains safe refs/version/sequence signals, not private message/evidence bodies, credentials or signed URLs |

Persist message and sequence before Socket/browser broadcast. On reconnect, check
current authority and fetch a bounded server cursor/snapshot; an expired retained
cursor returns an explicit recovery state, not invented continuous history.
Socket acknowledgement proves only the documented browser transport observation;
it cannot establish database commit, third-party delivery or a user read.

Membership removal is source-derived and revision/fence ordered. Reassignment
must deny the former participant's read, send, subscribe and reconnect, including
guessed conversation IDs and old open sockets. New participant history access is
an explicit scoped policy, not automatic access to every earlier private thread.
Check current owner/Identity authority for sensitive operations and before send/
reconnect; event-fed membership caches alone cannot cover revocation lag. An
authority dependency outage yields unavailable/denied temporary
access, never permissive stale fallback. Audit scoped Support entry separately.

Revocation processing stops pending obsolete intents, advances membership epoch
and invalidates affected subscriptions/capabilities. A racing stale event or
worker cannot revive the old epoch. The accepted contract must specify the
authorization linearization/fencing boundary for a concurrent send/removal,
bounded cache policy and treatment of data already delivered. W04 proves actual
assignment/access revocation; future Booking cancellation notification behavior
remains a W05 proposal.

Freeze a closed **source event → template/version → authorized recipient → purpose**
matrix: current assignment/allowed Work progress, cash receipt and approved
custody discrepancy/settlement. Reassignment/supersession suppresses obsolete
instructions. No generic broadcast, campaign or new marketing consent is implied.
Contact resolution is authorized and minimal; precise location, proof images,
identity documents, message text and permanent Media URLs never enter generic
events or logs. Evidence attachments require actual Media clean/finalized,
matching-purpose/object authority, with fresh private read capabilities.

### Delivery truth and bounded recovery

Queued persistence, sending, provider accepted, provider-observed delivery,
browser receipt and user read are separate facts. Proposed closed states from
earlier CP-D-003 include queued/suppressed/sending/provider-accepted/delivered/
read/retry-wait/unknown/failed/expired/cancelled; E/D must freeze exact enums,
nullable timestamps and channel-specific capabilities before publication.
Do not infer a delivery timestamp from provider acceptance, a Socket receipt or
work/payment completion. Read requires the authorized supported read mechanism.

Persist the attempt before calling an approved fixed provider endpoint. A timeout
after submission is **unknown**, not failed or delivered. Query/reconcile the
same documented provider request before retry. If the selected provider lacks
safe idempotency/query/callback capability, keep ambiguous outcomes pending for
the accepted manual recovery workflow; no blind resend or exactly-once external
delivery claim. Local attempt leases do not remove that external ambiguity.

Schedule transient retries durably with policy-bound delay/jitter, maximum
attempts, expiry, cancellation/supersession checks and observable exhausted work;
do not use process memory or broker requeue as the send schedule. Permanent
provider rejection, unavailable configuration, unsupported channel, expired
intent and revoked purpose have distinct safe outcomes. Audit manual reconciliation
and any separately authorized correction notice; an already delivered message
cannot be unsent. Historical source replay/Reporting rebuild never creates a
second send or revives an expired reminder.

No real SMS, push, WhatsApp, email delivery adapter or provider availability is
assumed. Identity's email OTP is not proof of Communications delivery. A provider
harness must be labeled as such and cannot establish live channel readiness.
An unavailable provider leaves durable honest pending/failure state. Selecting
a channel needs approved provider documentation, credentials/configuration,
verification/replay rules and actual independently evidenced outcomes.

## 6. Reporting independent facts, checkpoints and B reconciliation

Reporting owns read copies only. Store Booking state, assignment/Work execution,
financial obligation, accepted collection, custody allocation/handover and
Billing-backed treasury settlement as independently versioned facts. Completion
is not collection; pending handover is not settlement. Moving collected cash to
custody or treasury does not create another customer payment or revenue amount.
No source absence is rendered as zero, unpaid, rejected or settled.

Required B contracts remain W03-B W04-B-01..07 plus D's prior refinements:
immutable collection/reversal and posting refs; stable business/operation IDs;
named Booking/Work/assignment/obligation revisions; market/holder/recipient;
accepted exact Money/policy; bounded per-receipt allocations and residuals;
declared versus observed Money; independent treasury evidence and current
approval; reconciled Billing settlement refs. B must close final command IDs,
posting triggers, enums/nullable variants, partial/overpayment/mismatch policy
and Billing↔Wallet coordinator. Wallet cannot create a second ledger.

Events need authenticated producer, event ID/hash, owner aggregate/revision,
causation/operation and permitted Booking/market/receipt/posting/handover linkage.
If safe events carry refs only, B/C provide scoped immutable snapshots and
retained replay/correction windows; Reporting never joins source databases.
Exact money uses canonical minor-unit strings and approved currency scale/policy;
aggregate by currency and approved period/timezone boundaries without floats or
cross-currency sums.

Proposed owned storage must include projection schema/generation, applied
event/contribution identity, per-owner aggregate contiguous revision checkpoint,
pending gaps, source observation/coverage and limited audit provenance. Choose
one accepted ingestion router with all dependent effects in one transaction, or
explicit namespaced logical consumers; a single shared Inbox cannot suppress
legitimate different projection/generation applications. Inbox, contribution
replacement, projections and checkpoints commit together before ACK. Persist
the new-generation application identity separately from receipt of the original
event so an authorized rebuild can apply history without resending notifications.

Duplicate bytes cause no extra contribution; changed bytes conflict; older source
revision cannot overwrite newer facts. Missing predecessor, reversal before
collection, settlement before referenced posting/handover and unknown supported
shape leave coverage partial/gapped. A future revision cannot advance a
**contiguous** checkpoint over a hole. Repair uses accepted owner snapshot/replay,
bounded buffering and audited recovery. Broker delivery tag and event timestamp
are not durable source offsets or proof that no events are missing.

A source-owner correction replaces/reverses the affected contribution once with
immutable provenance; Reporting never edits receipts, creates balanced postings,
approves settlement or emits compensating financial commands. Rebuild uses a
new fenced generation, includes permitted redaction/correction history, verifies
coverage/invariants, then atomically changes the read pointer. Old generation
remains explicitly stale on failure; pinned pages cannot mix generations.

Every section/page exposes source owner/revision, evaluated/as-of time,
generation, contiguous coverage and accepted freshness/availability state.
Define current/lagging/gap/rebuilding/failed and complete/partial/stale/unavailable
semantics with actual thresholds selected by policy. Last received event time
alone cannot establish freshness of a quiet source; require accepted source
watermark/heartbeat or authoritative bounded snapshot coverage. Workforce live
positions retain their own source update/accuracy/stale/offline status and do not
inherit a dashboard's freshness claim.

Reconcile exact per-currency receipt/reversal/allocation/settlement contributions
and source revisions with **B's authoritative scoped reads**, showing missing
references/discrepancies and lag. Treasury approval, collection eligibility,
refundable amount and custody acceptance always recheck the owner; a Reporting
row or refreshed screen cannot authorize them. Source-local audit remains
authoritative even when Reporting is unavailable. Read fieldsets/cursors are
bounded and scope/generation/query-bound; exclude raw financial proof, identity
documents, contacts, precise tracking and conversation bodies. Sensitive exports
are separate accepted purpose/grant/Media/retention work, not implied by these
W04 queue/dashboard projections.

## 7. Transport, compatibility and provider evidence to close

E/producer/subscriber owners must verify every required durable binding and ACL
**before activation**. `mandatory` detects zero matching queues; positive confirm
does not prove every intended subscriber binding, every consumer commit or user
delivery. A stopped consumer catches up only if its durable queue/binding already
existed; later subscription needs accepted source history. Keep per-service queues,
producer-owned publication authority and protected DLQ replay; default exchange
or a JSON `producer` field cannot grant another service publication authority.

E W03 `DEFECT_LEDGER.md` also records final-attempt expired Outbox lease parking,
publisher listener lifecycle, confirm→finalize crash evidence, partial-binding
activation and unproven DLQ transfer. These remain source/adoption risks, not
resolved by reusing the probe relay. Return shared fixes to E and actual producer
stores to their owner. Exhaustion/unknown recovery must remain durable and safe;
broker restart cannot reset its budget or erase an integrity conflict.

Real provider gates must cover owned migration apply/no-op/upgrade/drift and
runtime isolation, current foreign/revoked participant/evidence denial, concurrent
message/read/intent attempts, idempotency same-key/different-fingerprint and
lost-response replay, INT-D-01 controls, crash/commit/ACK ordering, reconnect and
membership revocation, provider accepted/delivery/read separation, callback
verification/reorder, ambiguous call and bounded retry expiry. Reporting adds
duplicate/order/gap/source-repair/rebuild/per-currency reconciliation and visible
lag. B/C app gates follow actual providers; W04's combined journey covers cash
collection → custody handover → independent treasury settlement without duplicate
effects. No W05 action is a W04 acceptance scenario.

Existing scripts, **not executed here**: each D service has `generate`, `build`,
`build:tests`, `typecheck`, `migrate:deploy`, `start`, with no `test:runtime` script.
Root `package.json` exposes `test:nest`, `test:contracts`, `test:unit`,
`test:integration`, `check:migrations`, `acceptance:preflight`, `acceptance:run`.
The existing unit/integration files cited above cover foundation behavior; new
business race/provider/checkpoint gates require owned implementation and E's
registered isolated execution. A passing foundation suite is not delivery,
financial, UI, Windows/device or production proof.

## 8. W05 contract reservations only

The following are missing concrete next-wave closures. They are **future
proposals**, never W04 actions or W04 execution gates. No provider is called,
refund posted, Booking cancelled/rescheduled or settled receipt corrected here.

| W05 family / required owner | Concrete schema, ordering and compensation requirements for next review |
| --- | --- |
| Electronic proof / Billing B with Media C | Intent/obligation/beneficiary/method refs and named expected revisions; private purpose-scoped finalized Media proof ref or accepted bounded provider transaction ref; stable proof submission/review operation, policy/reason/actor. Freeze review states and separate submitted/reviewed evidence from independently verified amount/currency/recipient/provider settlement. Current finance authority, verified callback/query identity/hash/order and audit govern acceptance. Invalid/quarantined/revoked proof is denied; ambiguous result remains pending; proof image alone never changes payment status |
| Cancel / Booking C, Scheduling/Dispatch C, Billing B | Scoped eligibility/read with current Booking/assignment/Work/payment refs and allowed reasons; command carries expected owner revisions, accepted cancellation/compensation policy and stable operation. Freeze races with start/completion/payment/collection and a durable coordinator: capacity release, assignment/work termination/revocation and any Billing compensation have distinct idempotent child operations. Expose requested/pending/partial/failed/complete owner outcomes without deleting history or claiming refund from cancel receipt |
| Refund / Billing B; Support requests, finance approves where policy requires | Original accepted receipt/payment and refundable balance/source revision; positive exact Money/currency; beneficiary, reason/policy/evidence and approval refs; stable refund/business identity. Distinct requested/reserved/approved/submitted/unknown/confirmed/rejected/failed outcomes; pending is not money returned. Freeze partial/remaining/refund-vs-collection/reversal/settlement races, independent approval, durable reservation/posting/refund linkage and provider uncertainty/recovery. Wallet custody remediation references Billing facts rather than crediting funds optimistically |
| Reschedule / Booking C with Scheduling C and Pricing B | Existing Booking/assignment/Work refs/revisions; owner-valid new quote and capacity refs, server-time expiry/timezone, beneficiary consent, reason/policy and stable operation. Define old/new reservation acquisition/release ordering and fencing, price/obligation difference approval and allowed execution states. Failed/unknown compensation preserves explicit old/new ownership and pending recovery; never silently release the only valid booking or confirm occupied capacity. Financial adjustment remains a separate Billing result |
| Settlement correction / Billing B and minimal Wallet B | Original treasury settlement/receipt/posting/handover/allocation refs, all named expected revisions, independent actor/approval/reason/evidence/policy and stable correction identity; declared/observed/affected/residual Money per currency. Append linked reversal/replacement postings; close mismatch/reopen/rejected/reconciliation-required outcomes and coordinator/order for Billing versus Wallet. Race correction/refund/reversal/acceptance without mutating old settled facts. D replaces projection contributions once only after authoritative new revisions |
| Communications/Reporting follow-up / D | Approved source→template/recipient/purpose matrix for proof review, cancel, refund, reschedule and correction; purpose/current membership revocation; durable queued/unknown/failure truth and no historic replay sends. Freeze privacy-safe source correction links, retained snapshots and checkpoint/freshness effects. Do not infer refund completion, booking cancellation or corrected settlement from a notification/read state |

W05 closure requires finance permission/audit separation, actual private Media
authority, retention/consent/purpose/provider evidence and compatible schemas/
clients/unknown-outcome reads. Exact names/versions, deadlines and approval
thresholds remain unaccepted. Paymera/provider decisions and Card samples do not
expand W04; customer stored value, withdrawals, payroll and provider payouts
remain outside the approved staff/team cash-custody scope.

## 9. Review inputs and boundaries

This plan derives from the current W04-D attachment and observed code, with:

- `AGENTS.md`, `docs/design/DESIGN_LOCK.md`, `docs/adr/0004-approved-ui-precedence.md`,
  the frozen reference manifest and `docs/VERIFICATION.md`: preserve approved
  references; missing production states require explicit design approval;
  historical evidence and foundation readiness are not current product proof.
- `architecture/adr/F001-monorepo-and-data-ownership.md`,
  `architecture/service-catalog.json`, `docs/ARCHITECTURE_AR.md`: exclusive source
  ownership, bounded contracts, separate money/booking authority and local audit.
- `docs/parallel/B/W03/W04_CONTRACT_PACKET.md`, sections “Proposed request /
  response / event requirements”, “Replay, ordering, errors and compensation”,
  “Provider-first review and gates”; B `CONTRACT_DELTA_REQUESTS.md` and
  `BILLING_DESIGN.md`: actual next-wave financial requests and unresolved policy.
- `docs/parallel/C/W03/W04_CONTRACT_REQUESTS.md` and
  `CAPACITY_AND_RECOVERY_PROPOSAL.md`: binding before Media/full Work, current
  assignment authority, durable source compensation and unresolved allocations.
- `docs/parallel/D/W01/CONTRACT_PROPOSALS.md` CP-D-003/006 and
  `docs/parallel/D/W03/W04_CONTRACT_REQUESTS.md`: prior proposed delivery,
  membership, checkpoint/correction and independent financial schemas.
- `docs/parallel/E/W03/TOPOLOGY_AND_W04_REQUESTS.md`, `DEFECT_LEDGER.md`,
  `COMMAND_EVENTS_AND_RECOVERY.md`, `ACCEPTANCE_PLAN.md`: shared transport,
  source-bound evidence and blocked release prerequisites.

This document supplies no accepted contracts, code fix, runtime test result,
merchant/channel readiness, automatic next-wave work, approval, merge or deployment.
