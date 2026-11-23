# W10-D operational disposition and release blockers

Status: **UNACCEPTED PROPOSAL / NO_GO / RELEASE_UNCERTIFIED**.
This document records closure requirements; it is not an executed runbook,
accepted contract release, measured release candidate or full-scope certificate.
Day 7 remains conditional. Required business/recovery cases are **BLOCKED / NOT_RUN**.

## Source and entry

Observed source: `8bfa805d033cb29373c33886bf71bce4885a2f67`;
tree: `9288ac9a1320221f309ce33b571a057f5ec2ea57`.
These identify the audit input, **not BASE_W10** or a deployed candidate.
The [release registry](../../../../architecture/parallel-contract-release.json)
still records W01, null BASE_W02, empty accepted business/client lists and no
BASE_W10. Existing package versions are contracts/event-contracts `0.0.2` and
the empty api-clients package `0.0.1`; no new accepted versions are invented.
W09 intake added 35 proposal/specification files and 8,466 lines relative to
`b47390c8ce04b2674e9222918bcd4e03fa5aed24`, with no runtime or harness changes.
Merged proposals therefore do not establish implemented or tested recovery.

The task explicitly expires the W01 bootstrap lease. Its stale registry expiry
text is not permission to continue cross-owner bootstrap writes. E retains
permanent shared-file ownership; D remains the permanent owner of its app and
five supporting domains, subject to the accepted-entry requirement. This packet
changes only this document. No dependent source implementation is authorized here.

## Evidence classes

| Class | Current, bounded disposition |
| --- | --- |
| Implemented | Identity V1 security/role foundations, gateway transport, isolated service/web boot and foundation messaging mechanisms exist in source. Their presence does not establish supporting business workflows. |
| Source inspected locally | This W10 document's source/script/registry and predecessor inspection only; no W10 build, test, database, broker, browser, provider or restore was run by this author. Root records any separately executed guards. |
| Locally verified | No new runtime verification claimed here. Historical foundation evidence remains attached to its original source/environment, never promoted to this candidate. |
| Unverified | Actual business providers, all three integrated apps, private artifacts, intended deployment and compatible populated upgrade/recovery. |
| Blocked | W10 entry, complete action/design approval, providers/policies/real inputs, numerical limits, operating roster, independent review and final-target evidence. |
| Integrated / staging accepted / release ready / deployed / operationally verified | None established by this packet; **RELEASE_UNCERTIFIED**. |

Current schema evidence is explicit: [Support](../../../../services/support/prisma/schema.prisma),
[Reviews](../../../../services/reviews/prisma/schema.prisma) and
[Configuration](../../../../services/configuration/prisma/schema.prisma) contain
only ServiceMarker. [Communications](../../../../services/communications/prisma/schema.prisma)
and [Reporting](../../../../services/reporting/prisma/schema.prisma) additionally
contain InboxMessage and a probe effect. There are no persisted product cases,
reviews, conversations, delivery attempts, configuration history or business
projection checkpoints in these schemas. Their workers parse the foundation
probe contract. [Admin bootstrap](../../../../apps/admin-web/README.md) explicitly
disclaims implemented product screens and returns foundation readiness 503.
Existing [Identity grants](../../../../services/identity/src/domain/auth-policy.ts)
include operations.dispatch, billing.read/refund, support.cases.read/write and
verification.review; super-admin receives the current 14 exported permissions.
Preserve these V1 grants while separately accepting finer business controls.

## Operational truth to preserve

- Private technician review belongs to C Workforce with purpose-scoped C Media
  evidence; correction, revision history and actual current work eligibility are
  distinct from E account status and D displaying a review decision. Activation
  must recheck current team/van/assignment/resource grants. Restoring old approval
  cannot revive suspended eligibility or a stale private-document grant.
- B Billing owns receipt/posting/refund/settlement decisions; Wallet owns approved
  custody/hold partitions linked to Billing, not an independently editable ledger.
  Booked, received, refunded, field custody, company collection and settled are
  distinct facts. A photo, completed wash, Support resolution or report total
  cannot prove receipt, company handover or financial finality.
- An uncertain financial result stays attached to the original operation,
  merchant/environment, exact Money, semantic fingerprint and status lookup.
  Current authority gates lookup/replay. Expiry, restart, restored row counters
  or a new request key cannot create a replacement refund or erase UNKNOWN
  exposure. Retain confirmed and disjoint reserved/in-flight/unknown obligations
  against applicable caps; late payment does not recreate C capacity or benefits.
- Support owns cases, assignment/history/escalation and nonfinancial resolution.
  An audited refund request must link to B's durable original operation and actual
  disposition. Case closure and Billing convergence have separate states.
- Reviews require C's actual completion eligibility; D owns uniqueness, approved
  edit/moderation/publication/retraction policy and corrected counts. Verification
  review permission concerns technician verification, not an implicit review-
  moderation or financial-proof-review permission.
- D Communications proposes conversation participant/membership bindings and owns
  its eventual delivery history; the binding allocation/protocol remains unaccepted.
  C supplies authoritative booking/assignment relationships and E the server-private
  Identity binding. Membership and consent must be current on send,
  history/read/reconnect and after restore. Operational and marketing purposes
  stay distinct. Durable acceptance, provider outcome, browser receipt and read
  are separate; cancellation or UNKNOWN is not delivered. Bulk audience review
  must preserve recipient isolation. OTP delivery does not establish SMS capability.
- Reporting owns derived reads only. Reconcile independent owner revisions,
  contiguous frontiers/gaps, per-currency values, metric numerators/denominators
  and definition/time-zone boundaries.
  Correct cancellations/refunds/moderation historically without mutating source
  history. Show freshness and stale/incomplete disposition; never use a projection
  to authorize finance, current eligibility or object access.
- Configuration publication needs typed owner validation, current E grants,
  revision conflict/replay rules, audit, immutable history and explicit consumer
  adoption. A new effective version or rollback cannot rewrite prior transaction
  terms. Currency precision, prices, geography, hours and policies need real inputs.
- Privacy intake/status needs an approved coordinator; each data owner fulfills
  its obligations with honest partial/retained/held results. The registry still
  has no coordinator or retention/anonymization policy. Retained financial history
  is not promised deletion, and required owner fulfillment is not silently deferred.
  Current masks/holds/auth must apply to exports, restored objects/history and replay.

## Accountable release blockers

All rows are **OPEN / BLOCKED / NOT_RUN**. Owners below identify responsibility,
not supplied operators. No real contact or approved numerical limit is inferred.
Closure needs actual evidence at the accepted candidate, not another proposal.

| ID / accountable owner | Exact missing input | Remediation and required gate | Retention / retest consequence |
| --- | --- | --- | --- |
| D10-B01 — E; provider owners A/B/C/D | Accepted BASE_W10, reviewed external schemas/clients/events and compatible producer versions; current registry has none. | E publishes actual immutable base/package release after provider-first reviewed acceptance; each owner proves real DB/HTTP/current-auth/constraint and contract behavior before dependent consumers. Parent stays INTEGRATION_PENDING. | Preserve proposal status and prior source references; a breaking profile requires a new common base and affected producer/consumer reruns. |
| D10-B02 — E deployment/release; each artifact owner | Exact RC source/tree, published and pulled repository image digests for apps/services/workers/migration jobs, config/protected-secret references, authorized environment/topology and deployment receipts. | Freeze the actual manifest and permitted existing procedures; verify served app assets and APIs bind to that artifact/configuration. Local image IDs, Docker builds and development Compose are insufficient. | Retain immutable digest/migration/config provenance without secret values; any artifact/environment/config change invalidates affected deployment and journey evidence. |
| D10-B03 — product/design; D admin; A/C app owners | Complete accepted 17-screen/action scope and Arabic/English/LTR/RTL production, error, pending, private and recovery state approvals; historical full-admin approval discrepancy remains unresolved. | Reconcile DESIGN_LOCK/ADR with F010 registrations through explicit owner decisions; complete every matrix action with real producer, grant, persistence/reconciliation and current pixel/interaction/accessibility evidence on all three apps. | Preserve frozen originals; no regenerated baselines, disabled required actions or reduced scope. New approved states require affected visual/interaction and journey retests. |
| D10-B04 — E Identity/gateway; C Media; approved privacy coordinator and each owner | Finer accepted business/object/purpose/guest/export controls, private byte delivery, approved coordinator/retention/holds and current post-restore authority profile. Existing Identity V1 grants are real but insufficient to infer these providers. | Prove current authorization before admission/status/replay/query/artifact download; denied cross-object/role/guest controls, revocation and retained/partial owner fulfillment. Restore masks and authority before private reads. Reporting must not grant rights. | Minimize/restrict evidence; preserve required financial history and deletion/hold dispositions. Auth, privacy, purpose or transport changes require fresh denial/export/restore tests. |
| D10-B05 — C Workforce/Media/Dispatch/Booking; E Identity; D admin | Actual technician correction/private evidence APIs, policy and employment/team model, current eligibility/activation and resources; real staff/device input. | C accepts narrow private review/correction/eligibility providers; D consumer and operator/customer flows prove suspension, corrected revision, valid activation and current assignment/start checks. | Keep correction lineage and bounded private evidence; old snapshots never reactivate grants. Eligibility, resource or proof-policy changes invalidate review/assignment/private-access cases. |
| D10-B06 — B Billing/Wallet/Subscription/Pricing/Catalog; C Booking/resource owners | Actual cash/custody/company collection/settlement, electronic proof/refund/status providers, official ShamCash/Syriatel protocols/entitlement and Paymera scope decision; authorized historical source/coverage/import mapping or independently reviewed verified absence. Separately approved representative fixtures cover isolated model/rehearsal cases only and cannot substitute for genuine historical migration/report acceptance. | Prove exact Money/currency caps, partial refunds, original-operation UNKNOWN/replay, independent B controls, immutable correction/import lineage, benefits/promotions and C cancellation/reschedule compensation. Missing pending inventory is unknown, not zero exposure; missing data/access is not verified historical absence. | Retain original economic/provider identities and current-authorized lineage with genuine source coverage and independent expected controls; no balancing plugs or legacy paid flags. Changes require affected finance/import/capacity/three-app recovery reruns. |
| D10-B07 — D Support; B Billing; A intake; approved privacy coordinator | Real case/event/resolution-request providers, assignments/escalation and approved intake/status plus each-owner fulfillment. | D persists nonfinancial decisions/history; accept B request/status provider first, then link durable audited financial requests and separate case closure from confirmed/rejected/pending B result. Prove partial/retained privacy outcomes. | Preserve case/audit/B operation linkage under approved retention and current access; no case replay becomes a second refund. Retest linked failures and privacy after relevant changes. |
| D10-B08 — D Reviews; C Booking/work authority; product policy | Real completion eligibility, review uniqueness/edit/moderation policy, public release/retraction and history/correction providers. | C accepts narrow eligibility provider, then D proves current owner authorization, duplicate/edit races, moderation and corrected public/report counts through actual apps. | Keep approved edit/moderation lineage and minimal public/private fields; lifecycle/policy/source changes invalidate eligibility/count/retraction cases. |
| D10-B09 — D Communications; A consent; C relationships; E trust; product/provider owner | Actual channel/provider entitlement/protocol, template/version/audience/schedule policy, current consent/membership and real delivery/status/callback disposition. | Accept relationship/binding inputs then D durable delivery/history provider; prove revocation/reconnect/read semantics, isolated bulk recipients, cancel/unknown recovery and permitted provider evidence. No inferred real SMS or uncontrolled customer send. | Preserve original message/attempt identities and purpose-specific dispositions; restore/replay must not resend historical messages. Retest changed provider, audience, consent or membership controls. |
| D10-B10 — D Reporting; all source owners; C Media; E transport | Accepted source events/history/snapshots, metric definitions/time/Money, independent frontier/gap vectors, real projection generations and scoped CSV/PDF/audit exports. | Source providers first; then atomic Inbox/effect/checkpoint, correction/rebuild/live catch-up and verified activation. Prove independent B financial and C lifecycle reconciliation, freshness, injection/content bounds and current query/download authorization. | Retain required originals/watermarks and minimized protected artifacts; hashes of D's own output are not an independent oracle. Source/definition/privacy changes require reconciliation/export/rebuild retests. |
| D10-B11 — D Configuration; typed policy owners; E Identity | Approved actual values and typed validators; publication/read/history/revision/adoption interfaces and authority policy. | Accept owner validation inputs, then D publication provider with atomic revision/audit/outbox and conflict/unknown lookup; consumers prove historical term stability and compatible explicit adoption. | Preserve immutable version history and per-operation snapshots; new effective versions invalidate affected pricing/finance/resource/config-adoption evidence. |
| D10-B12 — E recovery orchestration; every data/artifact owner | Authentic prior populated state/backup members/cut vector, accepted upgrade/rollback-or-forward graph, actual procedures and compatible current authority plus fresh execution incarnation outside restored state. W09 recovery is NOT_RUN. | Allocate permitted destination/fault scope; establish fences before workers/private access; compare independent owner records/artifact bytes, pending external originals, corrections/frontiers and live catch-up after populated upgrade/restore/rollback. Measure real loss and elapsed recovery against approved bounds. | Preserve backups and original pending effects under approved access/retention; no peer SQL, ledger edits, queue/Inbox clearing or historical resends. Changes require affected populated recovery and denial retests. |
| D10-B13 — D Inbox; E messaging/lifecycle; B publishers | Unclosed current source hazards and genuine candidate-bound race/drain/restart tests; no accepted entry for source repairs. | Fix narrowly at each source owner after entry, then test actual PostgreSQL/Broker concurrency and interruption. INT-D-01 and six D08 controls remain required; E/B retained lease/fencing/listener/cleanup hazards need their own actual closure. | Retain integrity/error lineage and unsafe resource disposition; no broad duplicate ACK or new financial retry. Re-run changed-store/worker/broker/recovery cases; static findings are not reproduced failures. |
| D10-B14 — product operations; E schedule/release; actual independent reviewer | Approved numerical workload/resource/latency/error/freshness/RPO/RTO limits, named primary/backup contacts and coverage/ack/escalation/abort; current review and mandatory/affected gate bundle. | Supply genuine inputs and permitted controlled rehearsals; measure observations, route/ack actual alerts, then follow serialized candidate and resulting-target checks below. No supplied contacts or numerical approval exists here. | Retain redacted source-bound results and unresolved findings; null measurements cannot mean zero loss/PASS. Profile, roster, source/config/evidence changes need applicable gates again. |

## Current source hazards and recovery gate

INT-D-01 remains visible in [Reporting store](../../../../services/reporting/src/inbox/prisma-inbox.store.ts)
and [Communications store](../../../../services/communications/src/inbox/prisma-inbox.store.ts):
any P2002/23505 from the whole transaction is returned as DUPLICATE without a
constraint-specific fresh winner lookup; the shared consumer ACKs DUPLICATE.
This is **static/open, unreproduced**, not a claimed observed loss or repaired bug.
The proposed repair must roll back, identify the actual failure/constraint and
re-read the winning event safely; same event/type/digest may duplicate, changed
content conflicts, absent/ambiguous winners or unrelated effect uniqueness fail.
Do not query an aborted transaction or infer safety from private error strings.

Carry `D08-RHASH-01/02/03` and `D08-CHASH-01/02/03`: changed-content absent-row
race, identical-content positive control, and actual unrelated effect uniqueness
rollback, independently on the two real stores. Their actual constraints are
`inbox_message_pkey`, `probe_projection_pkey` and `probe_notification_pkey`.
Current probe upserts need a genuine competing insert seam for the third case.
Current digest hashes decoded UTF-8 text; a strict wire-byte profile remains an
unaccepted E prerequisite. Probe tests cannot prove absent business checkpoints.

Retain E W09 findings on bounded shutdown/DB cancellation, independently awaited
cleanup/readiness/pressure and B W09 final-attempt leases, reused worker fencing
and publisher listener accumulation. No source changes or fixes came from W09
proposal merges. Recovery must include queued/unacked broker restart, worker
interrupts, duplicates/reordering/gaps/provider outage and populated correction
history, with independent source controls; process health is a separate fact.
A fresh execution incarnation must deny a surviving pre-restore worker even when
old counters/claims return. Killing processes alone does not prove this fence.

## Existing command inventory — not executed here

These names exist in current package/scripts; none is an invented staging hook.
Every runtime command needs E's genuine allocated resources/context and accepted
dependencies. This author executed **no** commands in this table.

| Existing command / scope | What it can establish, with its actual prerequisites |
| --- | --- |
| `pnpm verify:toolchain` | Actual resolved toolchain check; configured pins Node 24.21.0 and pnpm 10.32.1 are not this packet's execution result. |
| `node scripts/check-design-reference.mjs` | Frozen-reference integrity, not UI/business/recovery acceptance; root records separately run before/after guards. |
| `pnpm check:migrations`; `node scripts/check-migrations.mjs --base-ref <actual-comparison-ref>` | Source migration/append-only inventory against explicit actual history; not populated upgrade, deployed drift or restore proof. |
| `pnpm --filter @carwash/admin-web run build`; `run typecheck`; `run test:runtime` with the same filter | Independent frontend build/typecheck and foundation HTTP boot; not 17 action families, pixels or business integration. Explicit customer/operator app commands are also required through E's full gate manifest. |
| D service scripts `generate`, `build`, `build:tests`, `typecheck`, `migrate:deploy`, `start` | Prisma generation/TypeScript or migration/main execution at that owner; runtime and migration identities stay separate. Normal startup must not migrate/reset. No restore/rollback implementation is implied. |
| Reviews/Configuration `test:runtime` | Foundation Nest tests; Support/Communications/Reporting have no corresponding package script, but their compiled Nest specifications are discovered by the root Nest runner. Absence of a package script does not mean absent foundation tests. |
| `pnpm test:contracts`; `pnpm test:nest`; `pnpm test:integration` | Current contract/Nest/foundation integration scope. Integration needs built artifacts and genuine E-owned CW_CONTEXT_FILE and may reset fixture schemas: never use accepted historical/staging/live data as its disposable fixture target. |
| `pnpm acceptance:preflight`; `pnpm acceptance:run`; `pnpm acceptance:gateway`; `pnpm verify:release` | Existing foundation/Identity/gateway harnesses; verify:release aliases foundation acceptance, not business release certification. |

No actual intended-environment deployment, D backup/restore/rebuild/rollback
executor or business acceptance command is supplied. E must publish real existing
procedures and permitted scopes before operation; this document invents none.
Recovery elapsed time, data-loss window, per-owner RPO/RTO and workload/freshness
comparisons are **NOT_MEASURED / TARGET_UNAPPROVED**. Contacts are **NOT_SUPPLIED**.

## Evidence invalidation, closure and stop boundary

Bind evidence to exact source/tree, contract/client/event bytes, migrations/schema,
published/pulled artifacts, configuration/auth/privacy policy, dataset/cut vectors,
environment/workload, approved designs and actual command/results. Later changes
invalidate affected prior tests; record case IDs and rerun them at the current
candidate. A later docs/evidence commit still needs applicable checks, but unchanged
runtime and green documentation checks never prove business integration/recovery.

E serializes each candidate from **latest target + exact PR head**, preserves all
mandatory CI and affected integrated/security/recovery gates, obtains required
independent review, rechecks unchanged refs and uses the authorized merge process.
If either ref changes, rebuild the candidate and recompute gates. Verify required
checks on the **actual resulting target** before publishing a new accepted base.
Same-login sessions and old head checks do not establish independent approval.

The [E release request](../../E/W09/RC_AND_W10_REQUESTS.md),
[deployment procedures](../../E/W09/DEPLOYMENT_MIGRATION_AND_ROLLBACK.md),
[backup reconciliation](../../E/W09/BACKUP_RESTORE_AND_RECONCILIATION.md),
[roster](../../E/W09/OPERATING_ROSTER_AND_DRILLS.md),
[B finance handoff](../../B/W09/W10_FINANCE_HANDOFF.md),
[B import lineage](../../B/W09/IMPORT_AND_LINEAGE_PROFILE.md),
[B recovery gate](../../B/W09/RESTORE_AND_STAGING_GATE.md),
[C field handover](../../C/W09/FIELD_REHEARSAL_AND_HANDOVER.md),
[C restore gate](../../C/W09/RESTORE_AND_W10_ACCEPTANCE.md) and
[D recovery](../W09/SUPPORTING_SERVICES_RECOVERY_RUNBOOK.md) remain unaccepted
source-grounded predecessors. Carry their required cases into current-candidate
evidence; no prior NOT_RUN case is closed by a merged document.

Keep the complete W10 action matrix and [acceptance specification](../../../../tests/parallel/D/W10/ACCEPTANCE_SPEC.md)
as the scope oracle; a fixture metric/map/save, missing required state/action,
unverified provider or failed/absent gate keeps full launch **NO_GO**.
Retain honest failures/blockers and restricted originals under approved policies;
public handoff artifacts must minimize private bytes, contact/message/proof content,
precise locations and credentials. No retention duration is fabricated.
Stop after reviewed proposal handoff. No automatic next-wave work, deployment,
real customer message, live payment/refund or destructive production exercise is
authorized. Only actual complete final-target evidence can change
**NO_GO / RELEASE_UNCERTIFIED**; this packet does not change that disposition.
