# W09-D supporting services recovery runbook

Status: **PROPOSAL_ONLY / BLOCKED_NOT_RUN / NO_GO for staging acceptance**.
Observed head: `b47390c8ce04b2674e9222918bcd4e03fa5aed24`.
Observed tree: `c8a1f2f9e84f6298f1b044a8e8cec2549f33c15f`.
Branch: `proposal/w09-D-staging-operations-entry`; this observation is not BASE_W09.
This is an English reviewable procedure, not an executed rehearsal, restore hook, approved schema or defect fix.
Only this assigned lane-local file is written; no service/app/shared configuration or other owner's data is changed.

## 1. Entry state and current source evidence

The release registry remains W01 / INTEGRATION_PENDING, BASE_W02 null, no BASE_W09,
no accepted business contracts/clients and no recorded staging candidate/environment/recovery profile.
Source packages remain contracts/event-contracts 0.0.2 and empty api-clients 0.0.1; these publish no business restore API.
Required policy/design authorities and service/shared runtime sources have no diff from the W08 observation.
AGENTS, frozen design authorities and F001's 19-owner catalog remain applicable; admin/Gateway own no business data.
The task declares the bootstrap lease expired; E must reconcile its stale registry/path inventory before any source implementation.

| Source inspected | Actual current state | Rehearsal limitation |
| --- | --- | --- |
| Support/Reviews/Configuration Prisma schemas | ServiceMarker only | no actual cases/reviews/policy-history populated dataset |
| Communications/Reporting Prisma schemas | InboxMessage plus probe notification/projection | no conversations/attempts/business checkpoint/rebuild/export data |
| D AppModules and admin runtime | BUSINESS_READY false / foundation-only | process boot cannot establish complete admin workflow recovery |
| Both D `src/inbox/prisma-inbox.store.ts` files | broad P2002/23505 catch → DUPLICATE | INT-D-01 remains static/open, not reproduced or repaired |
| Shared Inbox consumer | decoded UTF-8 digest, conflict dead-letter, duplicate ACK | byte profile/race disposition still needs E/D acceptance and real tests |
| E-owned integration/recovery tests | foundation probe and bounded lifecycle seams | not completed D business backup/restore or staging proof |

Current D migrations remain foundation-only: Support/Communications/Reporting `20260920000000_sprint_02_foundation`,
Reviews/Configuration `20261005060000_w01_foundation`; no new migration ID is created here.
Marker/probe backups, blank databases and frontend fixture persistence cannot substitute for real prior accepted D records/artifacts.
Identity account/session/role/status runtime is real; new object/purpose/guest/export/replay/config grants remain unpublished.
Its current roles/status provider rechecks the actor in the write transaction, revokes target sessions and audits the change.
Preserve existing support, finance, dispatch and verification grants; none grants all D/peer business actions automatically.
Existing Workforce verification route `/admin/reviews/:id` is not customer-review moderation.
Reporting freshness, a historic grant or a restored role field never establishes current authorization.

Read [W08 recovery/security proposal](../W08/SECURITY_PRIVACY_EXPORT_RECOVERY_PLAN.md),
[W08 operational requests](../W08/W09_OPERATIONS_CONTRACT_REQUESTS.md) and [W07 Reporting plan](../W07/REPORTING_RECONCILIATION_PLAN.md).
Latest E inputs are `docs/parallel/E/W08/W09_REHEARSAL_AND_CONTRACT_REQUESTS.md`,
`FAULT_AND_CONCURRENCY_CAMPAIGNS.md` and `PERFORMANCE_PROFILE_AND_RESOURCE_BUDGET.md` in that E folder.
B/W08 `W09_RESTORE_HANDOFF.md` preserves original financial operations and requires fresh restore-incarnation fencing.
B's current W06 privacy fulfillment remains required; the old W05 deferral is superseded, not a current exemption.
No proposal publishes accepted recovery budgets, provider connectivity, team contacts or actual staging access.

## 2. E-controlled preflight: all required inputs currently unavailable

Before execution, E must supply and owners verify a retained immutable rehearsal manifest containing:

- accepted BASE_W09 and deployed candidate source/tree, image repository digests and actual pulled artifact identities;
- environment identity/namespace and already-approved staging scope, permitted accounts/service identities and current grants;
- contract/client/event versions, exact migration IDs/order, compatible prior populated product source and schema;
- approved backup point/object/checksum/coverage, private artifact inventory and precise restore/rollback/forward procedure references;
- per-owner authority/privacy checkpoint sources, replay/history availability and fresh restore/process-incarnation fencing;
- numerical recovery/profile approval, timing origins, fault boundaries, abort conditions and independent cleanup budget;
- isolated DB/runtime/migration roles, queues/DLQs/object/browser prefixes, ports and one allocated heavy-test slot;
- actual operational owner/on-call contacts, alert routing, acknowledgement/escalation/abort authority and evidence location.

Each input is UNPUBLISHED / NOT_AVAILABLE here. Absence blocks execution; no fabricated namespace/account/backup or zero-valued dataset fills it.
E orchestrates deployment, backup, restore, rollback, infrastructure and shared gates; D verifies only its authorized service state.
A/B/C verify their authoritative records and compensation through accepted APIs/events/manifests, never D's direct peer SQL.
E's 23 foundation image inventory is not an accepted business deployable cap or proof of pulled staging workers/migration jobs.
Use genuine permitted isolated recipients and representative accepted data; no production customer messages or live money/refunds.
Frozen references, seven customer steps/guest/optional plate, Arabic RTL/motion/focus and required approved production states remain gates.
Missing English/LTR/detail/recovery/export states remain explicit blockers; a runbook does not approve a new screen.

Register owned fault/recovery/cleanup before any interruption; record actual process/container/worker identities when allocated.
Do not rely on a timed-out body's finally or assumed AbortSignal handling to stop underlying DB/worker activity.
Await cancellation/drain, dependency restoration and every cleanup error before another case reuses that namespace.
E/W08 explicitly records Case D3 swallowed finally recovery errors and real blocked-DB cancellation as still unproved.
The Case A awaited-cleanup fix and mocked cancellation unit regressions do not establish all fault cases safe.
No shared down/prune/reset, broad process kill, queue deletion or production restore is authorized by this proposal.

## 3. Role-specific operational handoffs

The labels below are the registered admin screen names, not functioning current business screens.
Use exact E-approved grants and current owner object/purpose checks; roles listed are not invented operational people.

| Role / screen | Authoritative status and permitted safe action | Escalation/evidence boundary |
| --- | --- | --- |
| Operations — Technicians / Fleet | C Workforce verification/resource eligibility; Media C for private documents; accepted current verification scope only | C decides correction/eligibility, E account access separately; do not grant work from document upload or map location |
| Operations — Bookings / Live | C Booking/Dispatch/Scheduling independent current lifecycle/assignment/capacity | current operations.dispatch is transport foundation; missing finer action stays blocked; C handles exception/replan |
| Finance — Payments / Wallets | B verified receipt/refund, approved holder custody and settlement independently | billing.read/refund does not grant arbitrary Wallet correction; B validates actual original operation and cap |
| Finance — Subscriptions / Promotions | B benefit/redemption/reservation and Billing outcomes, each revision/policy | unknown purchase/refund/restoration uses original owner lookup; no D counter or ledger edit |
| Support — Disputes | D case/assignment/history/resolution and independent B remedy operation | support.cases.read/write exists; current case scope/private evidence and real provider are still required |
| Support — Reviews / Notifications | D moderation/publication and communication intent/attempt/outcome separately | finer grants/producer/template/channel contracts required; no KYC reuse or resend to clear failure |
| Permitted roles — Dashboard / Reports | D source watermark vector/coverage/gaps and B/C authoritative comparisons | stale/partial data is visible; Reporting never authorizes a source mutation or marks money received |
| Approved publisher — Settings | D Configuration active/version/history and required consumer adoption | current role controls belong to E Identity; publication never changes past ledgers/Booking snapshots/grants |

For revoked access: stop privileged UI interaction, discard principal-bound private caches/subscriptions and fence late responses.
Reauthenticate through E, then recheck current owner scope; never automatically replay an abandoned privileged mutation.
For a private document problem: preserve only safe object/purpose/revision references, deny quarantined/foreign/revoked retrieval and escalate to C.
For failed verification/unsettled cash/refund escalation: record original B operation/result and independent custody state; proof or case closure is not money.
For stale reports: retain query/definition/generation/source-vector references and request bounded owner reconciliation, not a manual total adjustment.
For provider outage: keep accepted/pending/unknown distinctly, retrieve the original operation and route to the provider's actual authorized owner.
Operations, Finance and Support team membership, contacts and availability are NOT_SUPPLIED; E/product must provide real escalation assignments.
No invented name, telephone, provider availability, alert acknowledgement or operational readiness is recorded.

## 4. Genuine pre-fault D data/artifact manifest

Each service emits its own approved bounded manifest under current purpose; the composed incident manifest links references without joining databases.
The cut may differ per owner. E/owners must approve a consistent-cut or explicit convergence protocol rather than assume a global revision.
Preserve source/schema/policy, scope, source-issued high-water/cursor, as-of, counts/checksum/control totals and declared omissions.
Record acknowledged durable operations between backup cut and fault separately; they define actual recovery/loss evidence.
Expected values come from independently captured accepted owner records, never fabricated totals or a snapshot derived from the restored system itself.

| D-owned family to preserve once implemented | Required independently captured evidence |
| --- | --- |
| Support cases/case_events | IDs, beneficiary/assignment revision, current state, ordered history/visibility and reason/audit provenance |
| Support resolution_requests | original intent/fingerprint/policy/approval, B operation/result references and independent case/remedy states |
| Reviews/moderation | canonical eligibility/completion refs, uniqueness, content/publication revisions, decisions/retraction/correction history |
| Communications conversations/messages | binding, participant/membership generation, committed sequence, accepted message identities and approved retained/redacted history |
| Notifications/delivery_attempts | logical intent, pinned template/audience/consent revision, schedule/cancel fence, original provider attempt and actual outcome |
| Configuration/history | immutable content/version/hash, validator results, effective activation receipt/fence and required consumer observed/applied state |
| Reporting/application state | source vector, contributions/corrections, applied frontier/gaps, generation/activation history and approved privacy mask |
| Transport/business receipts | original event/body digest and independent operation identities, applied/pending/conflict disposition and source revision |
| Audit/export metadata | minimal actor/action/purpose/revision/result provenance, job/query/fieldset/source manifest and private C artifact references/checksum |

Private bytes are C Media's responsibility; D records their real owner-issued inventory/reference and permitted verification result.
Preserve artifact quarantine/scan/retention/expiry/private-grant state; a reference with missing bytes is not a restored export/evidence object.
Keep financial request lineage without storing B postings as D-owned journal data.
Retained privacy/financial history and current suppression decisions require owner policy, not automatic deletion or indefinite retention.
Raw event/DLQ bodies are private data under approved retention; generic evidence/audit contains only minimized references/digests.

## 5. Proposed backup/restore and rollback procedure

These are reviewable steps for E to bind to existing accepted operational commands; no executable backup/restore API is invented.

1. Verify the immutable entry manifest, permitted scope and independent populated D/A/B/C records/artifacts; otherwise stop as BLOCKED.
2. Capture pre-fault authority/privacy state, owner source vector, original operations and actual queue ready/unacked/DLQ state through approved interfaces.
3. Register recovery/cleanup, quiesce or fence only approved affected workers/writes, and record accepted backup cut/coverage/checksum.
4. E restores the retained compatible data/images/configuration into the allocated destination using the approved procedure; D records actual outputs.
5. Before workers or private reads resume, establish a fresh restore/process incarnation and current E service/session/guest authority.
6. Apply current owner privacy masks/holds/revocation/retention to restored copies, artifacts and history/tail before disclosure or execution.
7. D verifies its immutable histories, operation receipts, constraints and compatible schema/worker/client/event versions against the pre-fault manifest.
8. Resume bounded source-status/history reconciliation and delivery under accepted fencing; original business/provider identities stay unchanged.
9. Rebuild/catch up D projections in a separate generation, prove source barriers/controls, then perform the accepted fenced atomic activation.
10. A/B/C/D verify actual scoped app journeys/negative permissions and independent owner totals; E retains measured recovery/loss and residual failures.

A surviving pre-restore worker must fail its old finalization/activation authority after restore, even if row revisions or lease counters were restored backward.
Fresh execution incarnation changes execution authority, not original business/provider/event identity; a process kill alone does not prove this fence.
Do not revive old current grants or disclose private Media because an older backup had an active role or member.
Current Identity checks/session/secret policy are E's responsibility; D never edits its sessions/keys/database to manufacture recovery.
Unavailable current authority/history/privacy mask prevents sensitive mutation/download/READY activation rather than using stale restored defaults.

Rollback must be preapproved for the actual schema/client/worker/event/artifact set and populated data.
E chooses compatible rollback or forward recovery at the approved abort point; an older image is not automatically migration-compatible.
Preserve original receipts, audit and accepted side effects; no destructive reset, new event ID or recreated refund/send.
Configuration rollback is a new approved publication/adoption outcome, not erasure of prior versions or retroactive business mutation.
Display-generation rollback preserves the live transport Inbox and verifies current privacy/source validity before exposing an older generation.
If no compatible safe rollback exists, keep the affected operation unavailable/reconciling and escalate to E/its data owner.
Document actual retained artifact digests, current migration state and source changes that invalidate earlier evidence; none is available here.

## 6. Owner-local verification hooks requested, not implemented

E/D must accept exact closed schemas, grants, paths and command/gate bindings before implementing a hook.
No route, executable script, checkpoint column or restoration endpoint is assumed to exist.
Proposed read-only inspection input binds incident/run, current actor/service/purpose, D service,
approved scope/interval/fieldset, expected application/generation, manifest selection and bounded cursor/limit.
Proposed output contains owner/schema/policy, snapshot/as-of/digest/coverage, original operation/event references,
current revisions/dispositions, aggregate/application head, contiguous applied frontier/vector, gap ranges,
active/rebuild generation, activation/fence result, privacy-mask revision and safe discrepancies.
Include immutable Configuration publication/history and per-required-consumer observed/applied/unsupported version where that provider exists.
Business effect/checkpoint/audit transaction consistency must be verified from actual accepted D rows; current probe schemas have none of those business fields.
Missing data returns unavailable/partial with named absent evidence, never invented counts, checkpoint zero or successful effect.
Inspection reads only D-owned data or public owner APIs; no peer credential, Prisma client or SQL is requested.

An optional accepted rebuild operation binds current authorized actor, reason, reviewed source selection/high-water,
query/metric/schema/policy, expected active generation/fence, privacy mask and bounded deadline/resources.
Persist scoped identity/fingerprint/original receipt/progress; same input resumes, changed meaning conflicts and revocation is rechecked.
Keep transport receipts while applying a distinct side-effect-free generation; receipt presence alone cannot suppress legitimate reconstruction.
Snapshot plus tail uses the owner's declared cursor boundary and durable live capture to close the race, not a timestamp guess.
Advance the applied frontier only after effect/receipt/contribution/checkpoint consistency commits; highest seen revision is not the applied frontier.
Pending gaps have a durable obligation and explicit disposition, not a completed effect inferred from ACK.
Verify required source counts/digests/currency controls/privacy masks/live catch-up, then atomically switch with current generation/incarnation fencing.
Interrupted/concurrent old generations cannot overwrite the new active one; preserve a valid serving generation or truthful partial/unavailable service.
Reconstruction never issues financial compensation, publishes a review, resends a historical notice, restores benefits or reopens work.

## 7. Required fault and integrity rehearsals

INT-D-01 remains open on both current D stores: any P2002/23505 is blindly classified DUPLICATE after transaction failure.
Shared consumer ACKs DUPLICATE; wrong-byte races or unrelated effect constraints can therefore be misclassified.
The bounded future fix requires verified Inbox constraint plus durable winning ID/type/digest in a fresh transaction;
changed bytes conflict, while absent/unreadable winner/unknown constraint remains failure, never false duplicate ACK.
`inbox_message_pkey` is distinct from `probe_notification_pkey` / `probe_projection_pkey`.
No fix or reproduction is claimed; current decoded UTF-8 digest versus accepted original-byte profile remains E-owned publication work.

Retain all six real controls from [W08 plan](../W08/SECURITY_PRIVACY_EXPORT_RECOVERY_PLAN.md):
D08-RHASH-01/02/03 and D08-CHASH-01/02/03, independently on each actual D store.
They cover synchronized absent-row changed-byte conflict, identical-byte positive duplication and unrelated effect uniqueness rollback.
Use real clients/transactions and actual constraint/broker disposition, not fake Inbox outcomes or scheduling sleeps.
Current upsert probes need an actual conflicting effect insert for the negative primitive control; future business invariants need their real schemas too.
Sequential Case C2 is not the race oracle; foundation Case C is not complete restored business-state proof.

Under E orchestration, required additional cases include:

- worker interruption before commit, after commit/before ACK, winner rollback and failed fresh winner read;
- broker restart with events already queued and already unacked, durable retry budget, poison/conflict retention and bounded catch-up;
- producer uncertain publication/final lease/stale worker, with original IDs and owner dispositions, not cleared attempts or queue deletion;
- provider acceptance followed by lost response/outage, resumed original operation and no duplicate send/refund;
- scheduled consent withdrawal/cancel-send fencing, revoked participant reconnect and accepted/delivered/browser/read distinctions;
- historical cancellation/refund/moderation correction during live rebuild and stale worker completion after activation;
- restore of an older privacy/grant snapshot with current masks/revocation, expired/foreign/private artifact denials and retained financial history;
- compatible populated migration/rollback, Configuration validator/adoption outage and independent post-health business catch-up.

B alone reconciles confirmed receipt/refund/settlement and reserved/UNKNOWN allowance; D links actual audited results.
Support case status and B refund status stay separate; no missing result becomes refunded, settled or zero-valued finance.
Reviews recheck real C completion/current beneficiary and apply current correction/retraction; no restored false verified label.
Communications preserves logical intents/attempts and current membership/consent; unknown provider outcome stays reconciling rather than resent.
Private artifacts/downloads reauthorize after restore; possession of an old job/link or generation never grants access.
Each remaining failure has an actual owner, disposition and accepted next action; unresolved owner/history/provider facts block acceptance.

## 8. Reconciliation, elapsed time and data-loss evidence

Compare post-restore D IDs/revisions/history/receipt dispositions/artifact checksums against independently retained pre-fault manifests.
Then compare report controls through real A/B/C/D APIs/history at matched definition/currency/cohort/timezone/scope/high-water.
Keep booked value, received funds, refunded money, field custody, settled funds, benefit units and case outcomes separate.
B's immutable postings/corrections are financial authority; D reports discrepancies and never inserts a balancing journal entry.
Ratings use current published sum/count and correction lineage; notifications count logical outcomes, not attempts as extra deliveries.
Declare per-owner coverage/gaps/as-of and current privacy filtering; no cross-service atomic snapshot or zero gap is inferred.
Actual restored records, immutable histories/private objects and safe current workflows—not health endpoints—establish business recovery.

Measure fault start, backup coverage/cut, restore start/end, process readiness, current-authority readiness,
source reconciliation, privacy-safe artifact availability and final business catch-up separately with approved clock/timing origin.
Calculate missing acknowledged durable operations/records per owner, lost-tail coverage and remaining UNKNOWN backlog from genuine evidence.
Distinguish approved privacy suppression/retained exceptions from unintended loss, with owner evidence for each disposition.
No loss-free claim comes from an empty dataset, process restart or matching restored copies of the same unverified manifest.
Elapsed recovery, data-loss window, per-owner RPO/RTO and target comparison are **NOT_MEASURED / TARGET_UNAPPROVED**.
No 3-second Gateway timeout, lease/delivery default or historical harness timer is an approved recovery objective.
Retain raw authorized samples/command results privately and bounded redacted evidence linked to exact source/tree/config/digests/run/actors.
Record actual permission checks, remaining failures, environment/resource limitations and expired/superseded evidence.

## 9. Actual command inventory: unexecuted, not staging interfaces

| Existing command/script | Actual scope / required prerequisite | W09 execution status |
| --- | --- | --- |
| `pnpm verify:toolchain` | configured toolchain verification; Node 24.21.0 / pnpm 10.32.1 pins | NOT_RUN by this author |
| `node scripts/check-design-reference.mjs` | frozen-reference integrity, not frontend or recovery acceptance | NOT_RUN by this author |
| `pnpm check:migrations` | source migration inventory/gates, not populated staging restore | NOT_RUN |
| D service generate/build/build:tests/typecheck | Prisma generation/TypeScript build, with accepted dependencies and owned worktree | NOT_RUN |
| D service migrate:deploy/start | Prisma migration application / compiled main; E-approved DB/runtime scope needed | NOT_RUN; not restore/rollback hooks |
| Reviews/Configuration test:runtime | existing foundation Nest tests | NOT_RUN; no business restore claim |
| admin test:runtime | foundation browser-server boot test | NOT_RUN; not 17-screen workflow acceptance |
| `pnpm test:contracts` / `pnpm test:nest` | current contract/foundation scope | NOT_RUN; missing business families stay blocked |
| `node scripts/run-integration-tests.mjs` | built artifacts, E-provisioned owned stack and genuine CW_CONTEXT_FILE | NOT_RUN; not existing staging authorization |
| `pnpm acceptance:preflight` / `pnpm acceptance:run` | current acceptance harness; E resource lease/context and actual affected gates | NOT_RUN; no full-product/recovery inference |
| root infra:up / infra:down | development Compose scripts, E-controlled resources | NOT_RUN; not authorized staging recovery commands |

Reporting/Communications/Support expose no test:runtime; no D business backup/restore/rollback/rebuild CLI exists.
Current probe worker source accepts `--stop-after`, `--crash-before-ack-after`, `--prefetch`, `--fail-effect`,
`--reconnect-min-ms` and `--reconnect-max-ms` flags.
Those are actual foundation seams, not published business repair or deployed staging fault commands; no invocation is invented here.
`scripts/acceptance/lib/recovery.mjs` is existing harness lifecycle support, not a backup/restore interface or proof underlying operations drained.
Root build/typecheck omit the three app builds/checks; E must publish explicit customer/operator/admin and actual staging journey commands.
No installs, product/staging tests, services, DB/broker faults, provider operations, backups/restores/rollbacks or staging writes were executed for this runbook.
Root's separate local source/guard/scanner diagnostics and draft publication are recorded in [HANDOFF](HANDOFF.md).
Owned runtime/process handles: **none**. Real/mocked W09 runtime results and new migration artifacts: **none**.

## 10. Stop conditions and handoff

Provider-first order: accepted E entry/resources/policies → real owner populated-history/current-authority providers →
D narrow verification/rebuild/config/export providers → A/C/D actual app/recovery consumers → E serialized combined rehearsal and review.
Split binding/artifact or validator/publication dependencies; a source provider never needs a full D dashboard to prove its own records.
Parent remains NOT_STARTED / INTEGRATION_PENDING until deployed candidate operations and recovery have measured real evidence.
Missing backup/interface/authority/artifact/fence/source-barrier or failed cleanup stops the dependent rehearsal and retains NO_GO.
Full required staging journeys include technician review/eligibility, cash to settlement, electronic proof/refund,
subscription/promotion, fleet restriction, Support resolution, moderated review and scheduled notification on all three real apps.
An unresolved row cannot be waived because cash booking or process health succeeds.
E supplies actual environment/commands/contacts and approves accepted hook schemas; D implements only separately authorized owned defects/hooks.
Any later source/config/artifact/evidence change invalidates its affected old result and needs fresh exact-candidate/resulting-target gates.
Independent eligible review and unchanged refs remain required; no self-approval, automatic merge or deployment is supplied.
This proposal provides no BASE_W10 acceptance bundle; measured observations and complete real scope must precede that handoff.
Next action: E/owners review this concrete procedure and publish entry/contracts/gates before bounded execution; stop at this task's reviewed handoff.
