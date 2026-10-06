# W07-D Reporting, reconciliation, export and Configuration plan

Status: **UNACCEPTED proposal / IMPLEMENTATION_BLOCKED / TESTS_NOT_RUN**.
Observed main/head: `f01e87f4619414960e9e39c65e523a3250fbcbaf`.
Observed tree: `2266f157ad2480855011d5da59e00e5b0cf1f68f`.
These are source observations, not BASE_W07 or evidence of product acceptance.
The Day 5 milestone is conditional; no W07 runtime, migration or provider operation is authorized by this document.
Only this lane-local document is written. All schemas, names, transitions and metric definitions below require owner/E acceptance.

## 1. Current source, predecessor evidence and ownership

`architecture/parallel-contract-release.json` still records W01 / INTEGRATION_PENDING,
BASE_W02 null, no BASE_W07, empty accepted next-wave contracts and empty existing clients.
Observed public packages remain contracts 0.0.2, event-contracts 0.0.2 and api-clients 0.0.1.
Their versions describe the foundation; they publish no W07 business API or accepted metric profile.
Mandatory design/policy files, locked references and Reporting/Configuration/shared product source have no diff from the W06 observation.
Read the current attachment, AGENTS and applicable preserved design/catalog/verification authorities before this proposal.
F001's 19 data owners supersede the older grouped architecture; admin and Gateway own no business truth.
The W01 17-screen matrix remains an incomplete action/design inventory, not an implementation result.
No dashboard total, SAR/USD fixture, Riyadh map point, example utilization or Card row becomes production data or provider approval.

| Source inspected | Actual capability | Missing capability relevant here |
| --- | --- | --- |
| `services/reporting/prisma/schema.prisma` | ServiceMarker, InboxMessage, ProbeProjection | business contributions, aggregate revisions, checkpoints, generations, jobs, audit projections |
| `services/reporting/src/inbox/consumer.runner.ts` | FoundationProbe parser, probe upsert and crash/reconnect seams | business sources, ordered corrections, owner history/rebuild/export |
| `services/reporting/src/inbox/prisma-inbox.store.ts` | one Inbox/effect transaction; broad uniqueness catch | safe concurrent hash classification and generation-aware business ingestion |
| `services/configuration/prisma/schema.prisma` | ServiceMarker only | drafts, validation, publication/history, effective activation |
| Reporting/Configuration `src/app.module.ts` | foundation; BUSINESS_READY false | owner-authorized business providers |
| `apps/admin-web/src/index.ts` | foundation-only browser boot | all 17 integrated admin screens/actions |
| A/B/C business Prisma schemas | markers; Catalog additionally has probe/outbox | actual source records/history/financial totals/consent/fleet/Media |
| D Support/Reviews/Communications schemas | markers or probe Inbox/effect | actual case, review, delivery and membership facts |

Reporting still has only `20260920000000_sprint_02_foundation`; Configuration has `20261005060000_w01_foundation`.
No new migration is created or named here; future schema and append-only migration changes remain D-owned.
E permanently owns all manifests/locks/TypeScript/Docker/shared packages, Identity/Gateway, architecture and infrastructure.
The task declares the bootstrap lease expired; E must reconcile its stale registry and permanent-path inventory before source writes.
No cross-owner code/Prisma import, peer database query, broad admin store or Fleet service is proposed.

Predecessor inputs are D/W06 `W07_CONTRACT_REQUESTS.md`, B/W06 finance requests,
A/W06 customer commerce/administration requests and C/W06 resource/compensation requests.
E/W06 `EVENT_RECOVERY_MATRIX.md`, `INTEGRATION_AND_CONTRACT_REQUESTS.md`,
`BLOCKERS_AND_DECISIONS.md` and `W07_SCOPE_GAPS.md` explicitly remain unaccepted.
Their recovery obligations are required publication inputs, not implemented APIs or passing fault evidence.
B/W06 now keeps required financial privacy fulfillment in W06; only compatible extensions are proposed for W07.
Its updated commitment does not publish acceptance or resolve the coordinator/retention/copy policy decisions.
Missing earlier-wave money, privacy, review correction, custody or recovery evidence is not renamed W07 success.

## 2. Frozen semantic profile and source contracts

E and each source owner must publish exact schema IDs/majors, parser/client exports, routes and events.
Money/revision/ID/time profiles currently differ among packets; this document adopts no competing candidate as approved.
Preserve strict existing BookingConfirmed V1; its Booking/customer fields do not supply price, completion or financial revisions.
New report/history families need reviewed additive exports or a new compatible major, never a widened strict reader.
Every fact names its authoritative owner/type/ID, source revision, business-operation identity and applicable immutable policy/snapshot.
Event identity, source operation, entity revision, publication version, stream cursor and projection generation are different values.
Producer authentication/ACL must bind the claimed owner; an owner string in an event payload is not provenance.
Money uses B's approved exact representation, currency, exponent and rounding/tax policy; no binary floating-point arithmetic.
Amounts from different currencies stay separate; no FX total without an independently accepted conversion source/basis/version.
Unused entitlement units remain units unless B publishes an approved valuation/recognition policy.
All time-bearing records distinguish occurrence, business-effective, posting, ingestion and query evaluation times.
Freeze which time selects a metric and how corrections restate it; consumer arrival time never defines business revenue.
Every mutation/recovery/export operation has a durable scoped identity, canonical fingerprint, receipt and authorized status lookup.
Scope binds current actor/delegation, owner/action, target/query selection and logical business identity.
Identical meaning replays original IDs/result after current authorization; changed meaning conflicts, including changed scope/fieldset.
Receipt/replay/cursor/history/privacy horizons, timeout/retry budgets and expiry behavior are owner-approved inputs, not guessed defaults.
Business-effect uniqueness survives a shorter transport receipt cache; an expired cache cannot create a new posting or contribution.
Publish typed safe errors for malformed/unsupported policy, denial/revocation, revision conflict, gap/expired cursor,
unavailable source, bounded-rate rejection, incomplete snapshot, pending operation and unknown outcome.
An unknown command resumes its original owner operation; Reporting performs no source compensation or financial retry.

Required source reads/events include current state, bounded history, correction lineage and a scope-bound snapshot manifest.
Each snapshot declares owner-issued cursor/high-water, covered scope/interval, policy/schema, revision coverage,
record count/checksum or approved control totals, as-of instant, privacy mask version and explicit omissions.
History pages bind the same immutable selection/high-water and authorized fieldset; live insertions cannot silently shift page membership.
Freeze per-owner published stream completeness, partitioning, predecessor sequence/revision and retention; do not assume all entity revisions emit events.
No global revision/order is inferred across Booking, Billing, Wallet, Subscription, Workforce or D sources.
If history expires or cannot prove completeness, leave the generation/report partial or unavailable and request an accepted replacement snapshot.
No peer SQL, unrestricted internal audit dump or arbitrary operator-supplied query repairs that missing contract.

## 3. Metric definitions, cohorts and independent financial facts

Propose an immutable metric-definition record: definition ID/version, purpose, source owners, approved dimensions,
numerator/denominator, unit, currency policy, temporal basis/cohort, exclusions, correction rule and privacy classification.
A report request pins that definition, scope/filter version, source/generation and approved date/timezone interpretation.
The following are candidate definitions to approve, not ready KPI values or invented accounting policies.

| Candidate measure | Numerator / denominator | Source and time/correction rule |
| --- | --- | --- |
| Gross booked value | sum qualifying immutable Booking amounts; no denominator | C Booking with B quote/money refs; selected confirmation cohort; cancellation shown separately |
| Cancelled booked value | sum cancelled amount/contribution within the same approved Booking cohort; no denominator | C authoritative cancellation/correction; never treated as received/refunded money |
| Received funds | sum distinct B-confirmed receipt/posting contributions; no denominator | B Billing; approved posting/effective period, independent of proof and Booking completion |
| Refunded funds | sum distinct B-confirmed refund/reversal contributions; no denominator | B Billing linked original operation; actual refund period or explicitly labeled original-receipt cohort |
| Net received flow | received flow minus confirmed refund flow in the same currency/time basis; no denominator | B approves cash-flow semantics; not automatically earned revenue or settlement |
| Outstanding field custody | exact approved holder/purpose balance at as-of; no denominator | B Billing custody lineage / Wallet approved partitions; include approved adjustments, not naive booked-minus-settled |
| Settled funds | sum distinct approved B settlement postings; no denominator | B reconciliation/handover evidence; custody movement is not a second sale receipt |
| Booking status share | qualifying bookings in each current state / all qualifying bookings in the same cohort | C lifecycle as-of; pending/unknown categories remain visible; historical correction replaces contribution |
| Service distribution | qualifying Booking units in an approved service class / the same eligible Booking cohort | C immutable B Catalog package snapshot; approve nonoverlapping classification, separate additive extras |
| Period growth | current minus comparison value / approved comparison-period value | same metric/version/currency/scope and approved comparable local periods; both sources must be complete |
| Completion/cancellation rate | completed or cancelled eligible Booking units / approved eligible Booking cohort | C completion/cancellation revisions; policy defines eligibility/window, not prototype percentages |
| Execution duration | sum approved actual execution durations / count complete valid execution intervals | C actual work start/end/pause policy; excludes invalid/missing intervals explicitly |
| Team/resource utilization | union of approved busy elapsed intervals / approved eligible available elapsed intervals | C Workforce/Scheduling/Dispatch/Booking contracts; clipped scope/time, overlap deduplicated, maintenance/leave policy approved |
| Current published rating | exact sum ratings / count current eligible published reviews | D Reviews publication/content/eligibility revisions; retraction/edit/correction replaces one contribution |
| Support resolution rate | resolved eligible cases / approved case cohort | D Support current decision revision; remedy outcome remains independent from case resolution |
| Notification delivery rate | supported confirmed-delivered logical notifications / approved eligible logical notification cohort | D Communications; dedup logical intents, show failed/cancelled/unknown separately; attempts are not extra recipients |
| Active customer/technician count | distinct eligible entities under the approved activity/grant definition; no denominator | A Customer / C Workforce respectively; freeze activity period and current status, no generic online fixture |
| Benefit consumption | actual distinct consumed units, separately reserved/released/remaining; no monetary denominator | B Subscription; approved beneficiary/period/corrections, no assumed value per unit |

The label “revenue” requires B-approved recognition, valuation, liability and expiry/refund semantics before use.
Received merchant credit, obligation allocation, Wallet balance/hold, subscription purchase and earned amount are independent facts.
Customer stored value, payroll, provider payouts and guessed ledger accounts are not introduced to fill a chart.
Confirmed/refundable amounts are B-authoritative; pending/UNKNOWN refund operations remain exposure, not successful refunds.
Custody handover/settlement may correct a holder position without adding to customer receipts; preserve original posting lineage.
Late receipt never resurrects C capacity/work, and a cancellation alone never produces a refund contribution.
For a cash-flow view use actual flow-period contributions; for a restated cohort view link corrections to the original cohort.
Publish both definitions separately if required; do not subtract an all-time refund from an unrelated current-period denominator.
Historical quote/price snapshots remain immutable even when a new price/promotion or settings version is activated.
State distributions include approved unknown/pending categories and cannot silently drop missing records to improve a percentage.
Zero denominator yields an explicit undefined/unavailable value under the accepted schema; no fabricated 0% or average.
Negative/zero comparison-period growth and incomplete periods require an approved display rule; prototype arrows do not establish one.
An empty complete source may yield a true zero; missing source coverage yields null/partial quality rather than zero.

Business timezone is an approved market input. F010 rendering Asia/Damascus is not itself a financial cutoff policy.
Current admin settings expose Riyadh/Stockholm fixtures; no default timezone/currency is inferred from them.
Propose half-open report intervals with explicit local-to-UTC resolution; E/owners must approve boundary and DST/skew behavior.
Local day boundaries use calendar instants, not a forced 24-hour duration; ambiguous/nonexistent local times need accepted handling.
Daily/monthly/cohort calculations declare inclusive/exclusive bounds and the pinned timezone/policy version in query and export.
Resource utilization uses approved actual elapsed intervals and denominators; location or assignment alone does not prove work.
Task-location source remains E/C's unresolved Booking-versus-Workforce decision; no synthetic positions or Geo-owned operational authority.
E/C must also publish the exact execution/completion authority and revision/history contract before duration or verified-service metrics consume it.

## 4. Freshness, source reconciliation and bounded queries

Each response includes metric/query definition version, projection generation, evaluated time and source watermark vector.
For every required owner expose as-of/high-water, applied revision/cursor, covered interval/scope, lag/gaps and quality reason.
Different owner snapshots are independently consistent; do not claim a cross-service transactional snapshot from one timestamp.
Freeze required-source completeness and acceptable freshness budgets per metric; no arbitrary delay threshold is selected here.
Proposed CURRENT, STALE, PARTIAL, UNAVAILABLE and REBUILDING states must describe actual source completeness.
An outage, unresolved gap or unverified snapshot cannot be labeled current merely because the consumer process is healthy.
Reporting query results do not authorize current refunds, assignments, media downloads, publication or account grants.
Sensitive actions obtain current owner status and E authority; stale report rows can only link permitted recovery reads.
Queries use closed approved filters/dimensions, bounded page/row/time ranges and cursors bound to scope/generation/fieldset.
No arbitrary SQL, client-selected private columns or contact-based cross-subject search is permitted.
Audit/source reconciliation compares matching owner snapshot/high-water, cohort, currency, definition and privacy scope.
Record control differences and missing source references; do not force totals to match by inventing adjustment facts.
B supplies authoritative financial reconciliation; D stores/report differences and never balances a second ledger.
The dashboard composes independently fresh bookings, payments, reviews, disputes and notification outcomes with explicit partial sections.
Technical health comes from observability and is separate from business completeness or report freshness.

## 5. Atomic ingestion, ordering and corrections

Proposed owner-local models include projection generations, source checkpoints, aggregate heads/contributions,
application receipts, pending-gap records, rebuild operations, audit projections and export jobs.
Exact names/keys/fields require E contract and D migration review; existing probe rows are not reused as business records.
Transport receipts and application/generation receipts must allow one original event to build a separate side-effect-free generation.
Track authenticated producer, original event ID/type/schema/hash, business identity, aggregate/source revision,
application/generation and applied/pending/conflict disposition; define their uniqueness independently.
Hash original received bytes before parsing; reserialized JSON is not the original-byte integrity digest.
Within one D transaction commit the validated receipt, owned contribution replacement/effect, aggregate head,
checkpoint and bounded audit disposition before ACK or visible applied completion.
Only an accepted contiguous application frontier advances a checkpoint; the maximum observed revision is not the applied frontier.
Per-owner contracts decide whether a full-state replacement can supersede older versions or a delta must wait for predecessors.
Do not infer a gap from an integer increment unless the source guarantees that public stream's contiguity.
Out-of-order rows are durably deferred or retried under accepted bounded policy; pending is distinct from applied.
If durable parking permits ACK, persist its resumable obligation/bytes or accepted minimal fact and disposition first;
never advance the applied frontier or claim business completion merely because transport handling committed.
Repair requests the accepted owner history/status/snapshot using original references and bounded selection.
Unsupported majors, changed bytes and poison remain quarantined; unavailable histories produce explicit unresolved gaps.
Older source revisions cannot regress a current contribution; duplicate domain effects under a new event ID cannot increment totals again.

Maintain one authoritative contribution per source/business unit and metric generation with its source/publication revision.
For historical cancellation/refund/moderation changes, remove the prior contribution and install the corrected one atomically.
Preserve correction/reversal lineage and both effective and recorded times; immutable B postings remain immutable source facts.
Refund-first or correction-before-original delivery waits/reconciles the linked original fact instead of inventing it.
A Reviews hide/retract removes one count and rating sum; later approved reinstatement restores its current revision once.
Support remedy and Communications outcomes update their own counters; neither changes received money or review eligibility.
Counter-only increment handlers and average-of-averages are insufficient for corrected historical reporting.

INT-D-01 remains **statically open; not reproduced and not fixed** on this source.
Reporting and Communications Inbox stores compare an existing hash but classify every P2002/23505 as DUPLICATE.
The shared Inbox consumer ACKs DUPLICATE; concurrent changed bytes and unrelated effect uniqueness can be misclassified.
Future D repair must identify the Inbox constraint, roll back and inspect the durable winning receipt/hash in a fresh transaction.
Same bytes may be duplicate; changed bytes conflict; no winner or unrelated constraint failure is not a duplicate ACK.
Require synchronized real DB same-ID/same-bytes and changed-bytes races, unrelated effect rollback and crash-after-commit/redelivery.
Existing sequential changed-payload/probe tests do not prove this concurrent branch or business contribution uniqueness.
E/B final-lease exhaustion, fencing, publisher lifecycle and real queued/unacked broker recovery risks also remain unclosed prerequisites.
D reports those source-owner dependencies; it does not modify B/E stores or claim docs repair them.

## 6. Rebuild with verifiable generation and privacy watermarks

An accepted rebuild request binds current authorized service/operator, environment, source set, metric/query version,
scope/interval/fieldset, expected active generation, immutable owner selection/high-water, policy and bounded limits.
Persist operation/fingerprint, per-source progress and recovery owner; a lost reply/restart resumes that original operation.
Create a separate side-effect-free application generation while retaining the current serving generation.
Capture live changes durably before/with the owner-defined snapshot boundary so no snapshot-to-tail race loses facts.
Load owner-complete snapshots through their declared high-waters, then apply the accepted corresponding history/tail.
Use provider cursor semantics rather than timestamps to determine inclusion; dedup original IDs/business units within that generation.
Reconcile source counts/checksums/approved currency controls, revision coverage and privacy mask before readiness.
Record each owner's live catch-up frontier, unresolved gaps and required completeness; no fictional global high-water is created.
Switch the active pointer atomically with expected-generation fencing only after all required proofs succeed.
Competing rebuilds, delayed old workers and pointer-switch crashes cannot overwrite a newer ready generation.
If rebuild fails or a source is unavailable, retain a valid current generation or expose truthful partial/unavailable service.
Do not clear live Inbox/projections to replay: retained Inbox can suppress rebuilding, while erased receipts can duplicate effects.
Retire old generations/jobs/artifacts only under approved retention and audit rules; preserve recovery evidence.
Replay builds views only; never publishes a review, sends a notice, charges/refunds, restores entitlement or reopens work.

Every snapshot/tail/rebuild uses current owner privacy masks, retained categories and suppression/tombstone versions.
Replayed events, quarantined raw bodies, restored backups and older snapshots cannot restore erased eligible personal fields.
Raw broker bodies are private retained data, not sanitized audit metadata; minimize/segregate and approve their retention explicitly.
Financial history retained under B policy survives; the view applies only approved owner redaction without losing reconciliation lineage.
Coordinator identity and retention/hold/copy handling remain unpublished; no global delete or statutory duration is invented.

## 7. Durable customer CSV, report PDF and audit query

D Reporting is the proposed report-job/projection owner; E/owners must explicitly accept export coordination/allocation.
A remains authoritative for customer CSV records/approved fields/current subject scope; D does not create a shadow Customer table.
C Media owns private artifact bytes, scan/finalization/retention and every later protected retrieval.
Split a narrow export-job binding/status provider before C's purpose-bound artifact provider, then D rendering/finalization consumers.
Candidate job fields: exportId/operation, current requester/purpose/scope, report/query/fieldset version,
source manifest/high-water vector, generation, format/locale, schedule/expiry policy, own revision/status and nullable artifact metadata.
Bind the canonical fingerprint to exact reviewed filters, columns, scope, currency/time basis and source/generation selection.
Same operation replays its original status/artifact reference; changed query/scope conflicts and cannot reuse authorization.
REQUESTED, WAITING_SOURCE, BUILDING, READY, PARTIAL, FAILED, CANCELLED and EXPIRED are proposed distinct states.
READY requires actual finalized private bytes, checksum, content manifest and approved completeness; a queued worker is not ready.
The actual C artifact must also satisfy its accepted scan/quarantine/usable-purpose state before READY or retrieval.
A partial artifact is permissible only under explicit approved scope/omission policy and visibly labeled metadata.
An unknown Media upload/finalization reply reconciles its original operation; do not create repeated export objects silently.
Cancellation fences a pending job; an already created/downloaded artifact cannot be represented as never disclosed or universally erased.
Cleanup/revocation uses accepted C operations with durable result; no assumed purge/recall guarantee.

Authorize query initiation, every source page, worker resume, artifact finalization, status and download using current actor/object/purpose/market.
A historical job grant, cached role or old signed URL cannot outlive current revocation, expiry or approved fieldset restriction.
Private artifact retrieval binds the actual export/requester and C purpose; no public URL or generic case/media permission grants download.
CSV/PDF files include source/metric/query version, timezone/date bounds, currency separation, as-of/coverage and omissions.
Customer contacts, plate/address, case text, message bodies, proof bytes and account bindings are omitted unless their exact field/purpose is approved.
CSV needs bounded Unicode encoding and escaped cells plus accepted nonexecuting treatment of formula prefixes,
including leading whitespace/control characters and =, +, -, @; quoting alone is not spreadsheet-injection protection.
Preserve approved values safely and test Arabic/contact/numeric representations without silently changing the underlying source fact.
PDF generation uses approved fonts/RTL/content layout and passive bounded rendering; no scripts, active attachments or untrusted remote fetch.
Rendering dependencies, format limits and required new download/progress/error designs are E/product prerequisites, not invented UI approval.

Each owner retains its immutable authoritative audit; D projects only the approved actor/action/object/reason/time/revision references.
Audit query has closed filters, bounded pages, current scope and explicit source gaps; it is not full private-case/event-body search.
Sensitive query/export initiation, source selection, finalization and download each record their own bounded audit disposition.
Never log raw query contacts, evidence, generated file bodies, provider credentials or another participant's Identity binding.
Audit projection repair preserves provenance and privacy policy; event ACK or export READY does not imply privacy fulfillment completed.

## 8. Configuration publication/history and Identity role controls

D Configuration proposes typed immutable drafts, validation results, publication versions, activation receipts and history.
Each draft identifies market/scope, schema/content hash, expected active revision, source-owner prerequisite revisions,
approved policy references, intended effective time and actor/reason; arbitrary JSON/scripts are not policy publication.
A/B/C own semantic validators for their geography, money, holds, capacity, eligibility, consent and financial rules.
First accept narrow validators against a typed candidate; they need not consume the future active publication they enable.
Validation returns owner/version/current prerequisite result tied to that exact content hash; missing/stale/unsupported results block activation.
Author/reviewer/publisher roles, approval/separation rules and limits require E/product decisions; existing general roles do not grant policy publication.
Review binds immutable content; changed draft or effective time requires the accepted renewed validation/review rule.
Activation uses expected-active compare-and-set plus current prerequisite checks, audited receipt/outbox and durable schedule fencing.
Freeze overlap/tie/boundary/cancellation policy and owner enforcement; no distributed simultaneous activation guarantee is invented.
Track each required consumer's observed/applied/unsupported version and actual result; publication is distinct from successful propagation.
Offline consumers reconcile accepted current publication/history and fail closed where a required version is unsupported.
Rollback is a new approved publication referencing earlier semantics, with compatibility/adoption evidence, not mutation of old history.
New settings never rewrite past Booking/quote snapshots, ledger/postings, cases, notifications or technician grants.
Source owners independently authorize any semantic correction; Configuration rollback does not trigger refunds/resource compensation.

E's current Identity roles provider is real: POST `/api/v1/admin/accounts/:id/roles` routes to Identity with `identity.roles.assign`.
`identity-auth.service.ts` rechecks actor/session/grant inside its transaction, increments target authVersion, revokes sessions and audits.
Its accepted body is roles only; do not pretend it already exports expected-revision/idempotent admin-edit or report/export/config grants.
Preserve existing roles/permissions and request any finer/additive semantics from E; Configuration never writes Identity tables or permissions.
Existing `/admin/reviews/:id` remains Workforce verification; new customer moderation stays separately owned and permissioned.
Gateway currently rejects query strings and lacks Configuration/Media owner routing and W07 report/export clients.
E must publish bounded query/cursor/error/conditional semantics, private byte transport, current grants and safe status mapping before apps integrate.

## 9. Provider-first children, proof gates and next action

Proposed children start only after an accepted common base/schema/policy release; they are not opened implementations.
1. E entry: reconcile current ownership/lease, profiles/policies/design decisions, grants, contracts/clients/topology and isolated resource manifest.
2. A/B/C/D source providers: real owned records and minimal complete history/snapshot/correction/current-authority reads, independent of Reporting.
3. Typed source validators then D Configuration provider; source policy consumers subsequently prove adoption of the merged real publication.
4. D Reporting ingestion/query/rebuild provider: real constraints/migrations/current authorization/owner reconciliation and narrow schema conformance.
5. Narrow D export binding plus actual A dataset/C private artifact providers, then D report/export/audit consumers against those merged providers.
6. A customer, C operator and D admin app consumers: full affected approved journeys against real merged providers, no fixture-only consumer merge.
7. E latest-target candidate and resulting-target gates: retained prior scope, mandatory CI, independent review and unchanged source refs.
Source providers never require a live Reporting dashboard to prove their own authority/history; later Reporting/app consumers close integration.
The parent remains NOT_STARTED / INTEGRATION_PENDING until every required 17-screen action and its integrated test is accepted.

Required Reporting cases: duplicate same/new delivery IDs, changed-byte race, unrelated effect rollback, gaps/out-of-order predecessors,
historical cancellations/partial refunds, refund-first delivery, review edit/hide/reinstate, separate money/custody/settlement and benefit units;
multiple currencies, zero denominators, exact timezone/month/DST boundaries, current source outages and stale/partial quality;
crash before/after effect/checkpoint/ACK, interrupted/competing/live rebuild and atomic switch, expired history and privacy-safe replay/restore.
Required export/config cases: actual CSV/PDF content/scopes/checksum/encoding/injection, restart/lost reply, revoked requester,
expired/cancelled artifact, per-page/current download authorization, privacy holds and retained financial records;
concurrent publication/edit, stale owner validation, effective-time/restart, unsupported/offline consumers and nonretroactive rollback.
Use isolated synthetic owner datasets and real services; compare only matched authoritative snapshot controls, not moving unrelated totals.
Run actual three-app customer commerce/coverage, operator resource/outcome and admin/report/export/settings journeys after serialization.
Approved seven steps/guest/optional plate, frozen Arabic RTL/motion/focus and Linux reference/candidate/diff evidence remain required.
Missing full English/LTR and production detail/search/export/settings/recovery states are explicit decisions, never silently removed matrix rows.

Existing Reporting scripts: generate, build, build:tests, typecheck, migrate:deploy and start; no Reporting test:runtime exists.
Configuration also has test:runtime, but it invokes a foundation Nest test, not publication/rebuild/export acceptance.
All apps expose build/typecheck; admin/operator test:runtime covers foundation boot, and customer has no test:runtime.
Root has check:design-reference, check:migrations, test:contracts, test:nest, test:integration and acceptance:preflight/acceptance:run.
E must publish exact new affected commands/gates; root build/typecheck alone omit the three frontend builds/checks.
Existing explicit app commands include `pnpm --filter @carwash/admin-web run build` and equivalent customer/operator build/typecheck.
Current configured pins are Node 24.21.0 in .nvmrc and pnpm 10.32.1 in packageManager; they were not executed/verified as this task's runtime.
E allocates/proves DB roles, queues/DLQs, object prefixes, ports/browser profiles and one heavy slot before any future fault/runtime case.
No installation, guard/test, runtime, migration, provider call, staging, commit or GitHub write was performed by this document author.
There are no process handles, real/mocked runtime results, measured throughput or new migration artifacts to report.
Performance budgets/measurements require actual accepted queries/export/rebuild datasets and environment; no estimate is called measured proof.
Next action: E/owners accept or revise schemas/policies/children, publish the verified base and exact gates, then authorize bounded implementation.
W08 security/fault proposals may follow the reviewed W07 handoff; this plan starts no next wave, merge, deployment or live-money operation.
