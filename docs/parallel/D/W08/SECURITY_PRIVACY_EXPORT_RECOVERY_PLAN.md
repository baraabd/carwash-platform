# W08-D security, privacy, export and recovery plan

Status: **UNACCEPTED / IMPLEMENTATION_BLOCKED / BUSINESS_TESTS_NOT_RUN**.
Observed source: `f0b76221c1a1991ba78327c019f0b4a0a7c53dff`.
Observed tree: `1a6b3a54e926fc9e3387ac547ecc20c3d3f4252d`.
Neither is BASE_W08. This file proposes bounded D hardening; it changes no application, service, migration or shared configuration.
Actual release remains W01 / INTEGRATION_PENDING, BASE_W02 null, no BASE_W08 and no accepted business clients/contracts.
Threat/workload budgets, privacy policy and new production states are unpublished; no plausible default becomes approval.
All proposed family names, fields, grant requirements and transition semantics need E/source-owner acceptance.

## 1. Current source and predecessor intake

Read current AGENTS and preserved design/catalog/verification authorities; their bytes and D runtime source are unchanged from W07.
F001 assigns each service its own schema/DB/rules. Gateway/admin own transport/presentation, and Reporting owns projections only.
D permanent source ownership does not grant writes to E manifests, locks, TypeScript/Docker files, shared packages, CI or infrastructure.
The task says the bootstrap lease expired; E must reconcile its stale lease/path registry before any source implementation.
Only this assigned document is written. Other sessions' untracked files are outside this author's write scope.

| Inspected source | Current fact | Security/acceptance implication |
| --- | --- | --- |
| D Support/Reviews/Configuration Prisma schemas and AppModules | ServiceMarker only; BUSINESS_READY false | business authorization, content/export/policy providers do not yet exist |
| Communications/Reporting Prisma schemas | marker, InboxMessage and probe effect | not message membership, notification delivery, business checkpoints or export jobs |
| Both D `src/inbox/prisma-inbox.store.ts` files | broad P2002/23505 → DUPLICATE | INT-D-01 remains statically open |
| `packages/platform-messaging/src/inbox-consumer.ts` | ACK applied/duplicate; conflict dead-letter; failure NACK | false duplicate can discard rolled-back work; actual store/transport proof needed |
| `apps/admin-web/src/index.ts` | foundation-only boot | no functional private case/review/export/admin provider acceptance |
| Identity auth service/controller/policy | real member sessions, roles/status and audit | reusable current authority; not new business-purpose or guest grants |
| Gateway domain/service/controller | exact route allowlist, current Identity transport, JSON response | no accepted W08 cursor/export/private-byte or finer owner APIs |
| `packages/observability/src/logging.ts` and `metrics.ts` | bounded technical redaction/labels | defense in depth; arbitrary private content remains prohibited |

Foundation packages remain contracts/event-contracts 0.0.2 and api-clients 0.0.1; clients export no business client.
Catalog business events and strict contract-only BookingConfirmed do not establish real report/refund/review/chat workflows.
No new migrations are proposed as already present; future D migrations are append-only with owned schema/upgrade tests.

Predecessors: [W07 security requests](../W07/W08_SECURITY_FAULT_PROPOSALS.md),
[W07 Reporting plan](../W07/REPORTING_RECONCILIATION_PLAN.md) and [W07 action matrix](../W07/ADMIN_ACTION_MATRIX.md).
Also consume E/W06 event recovery and E/W07 hardening/target-freeze requests, plus B/W06 privacy and B/W07 adversarial requests.
B's current proposal keeps required financial privacy fulfillment in W06; the old B/W05 W07 deferral is superseded history.
Required predecessor privacy/reporting/export/permission failures remain blockers; W08 hardening never waives those tests.
Privacy coordinator and retention/anonymization values in the release remain null; D cannot appoint itself by proposal.

### Fresh test-source changes: limited meaning

The f01e→f0b delta changes E-owned `tests/integration/outbox-inbox.test.mjs` Case A and
`tests/unit/f008-recovery-scope.test.mjs`; do not claim all tests are unchanged.
Case A now uses recoveryScope with awaited owned-worker cleanup and broker readiness after cancellation,
checks the original relay PID remains alive, and verifies actual recovered probe delivery/projection.
The two new unit fixtures extract that body with injected lifecycle dependencies for relay/consumer cancellation.
They test harness cleanup ordering with mocked lifecycle objects, not actual Inbox races or business providers.
Case C still describes real probe crash-after-commit/before-ACK; Case C2 remains original-then-altered sequential replay.
Neither new Case A cleanup nor sequential C2 closes INT-D-01. This author executed none of these tests.
Old green evidence or source assertions do not establish current W08 runtime or business acceptance.

## 2. Existing Identity V1 versus proposed business authority

Current E roles/status providers use `identity.roles.assign` and `identity.accounts.suspend`.
`services/identity/src/application/identity-auth.service.ts` rechecks actor/session/permission in its write transaction,
blocks self-escalation/self-suspension, increments target authVersion, revokes sessions and writes audit.
Their controller bodies contain roles or status only; expected-revision/replay/step-up extensions are not already accepted.
Current grants include operations.dispatch, billing.read/refund, support.cases.read/write and verification.review.
Preserve these actual grants. `verification.review` authorizes Workforce verification, not customer-review moderation.
Super-admin has the current exported permission list; that list contains no new report/export/template/privacy/config publication grants.
Current account-bound sessions are not an accepted guest Support/review/chat/export capability or recovery provider.
E publishes any needed finer current action/object/market/purpose/service/delegation/guest authority through versioned contracts.
Do not infer privileges from screen labels, a report row, old approval, public ID, phone/plate or browser-supplied actor.

Every owner rechecks current subject/session/authVersion, accepted service audience and object/purpose/action at protected reads/writes.
Gateway's verified headers are transport output, not an independent business-object grant; owners validate the trusted authority themselves.
Reporting never grants refund, assignment, moderation, private Media or Identity access from projected facts.
Staff revocation/reassignment, guest expiry, subject changes and unavailable authority have explicit deny/pending outcomes.
Historical staff participation/retained transcript scope needs approved policy; current routing alone never permits new protected access.
Public projections omit other participants' private Identity bindings, full grants and private beneficiary maps.
D proposes participantRef/membershipGeneration conversation bindings; C owns current Booking/Dispatch relationship facts and E owns the private Identity mapping. The binding contract and ownership seam remain unpublished/unaccepted.
Current-authority reads and purpose checks prevent stale event/reconnect history from restoring revoked membership.

Browser private caches and in-flight responses bind the principal/session and scope generation; logout/expiry/subject change invalidates them.
Late responses from a prior principal cannot repopulate private case/message/export state.
Query, mutation replay, every page, worker resume, artifact publication/status and download reauthorize their accepted scope.
A saved query/selection or job approval is historical evidence, not continuing permission.
Cookie mutations retain E's actual Origin/CSRF protections; source-owner positive controls and direct-owner negative cases remain required.
Error responses follow the accepted not-found/denied policy without disclosing a foreign object's existence or private owner details.

Gateway `routeMatch` rejects query strings, percent/backslash/hash paths and unexpected segments.
Its owner vocabulary lacks Communications/Reviews/Configuration/Media and no W08 business clients are exported.
Do not loosen routing into arbitrary owner/path forwarding to enable filters, cursor pages or downloads.
E must accept bounded query/cursor/conditional handling, safe typed errors and private byte transport before D consumers use them.
Current JSON buffering/response rendering is not an approved Media download stream.
Gateway idempotency-header syntax validation is not an owner receipt or proof a timed-out command did not commit.

## 3. Bounded INT-D-01 fix proposal: two D stores only

Source finding, **not reproduced exploit or runtime failure**: each applyOnce transaction compares an existing hash,
but its catch returns DUPLICATE for every P2002/23505 across Inbox insertion and arbitrary effect execution.
Exact D sources are `services/communications/src/inbox/prisma-inbox.store.ts`
and `services/reporting/src/inbox/prisma-inbox.store.ts`; their current Inbox records have no business generation/checkpoint.
A concurrent absent-row loser may carry changed bytes; an effect constraint failure may leave no committed Inbox row.
Shared InboxConsumer ACKs that duplicate outcome; a rolled-back or conflicting event can therefore be misclassified.
This is a required current correctness blocker, not an optional future optimization.

Actual migration constraints are `inbox_message_pkey` on event_id in each owned DB,
`probe_notification_pkey` on probe_id in Communications and `probe_projection_pkey` in Reporting.
P2002 or SQLSTATE 23505 alone does not identify which constraint failed.
Proposed future D change keeps the Inbox/effect transaction and its original failure boundaries:
1. Distinguish the Inbox insert stage/verified event-ID constraint from unrelated effect or database errors.
2. Let the failed transaction roll back; never query within an aborted transaction or partially commit its effect.
3. For a verified Inbox-identity collision only, perform a bounded fresh lookup of the durable winning Inbox receipt.
4. Compare the stored event ID/type and digest under the accepted parser/profile; equal identity/bytes gives DUPLICATE.
5. Changed digest gives CONFLICT; absent/unreadable winner, unknown metadata or another constraint remains a failure, never duplicate ACK.
6. Preserve safe owner-private integrity disposition and original IDs/digest; no fabricated effect, event replacement or receipt deletion.

Constraint normalization must be based on actual Prisma/adapter error metadata captured in controlled real tests.
Do not assume an unobserved meta.target/driver shape or match a private error message substring as authorization to ACK.
Unsupported/ambiguous shapes fail closed through the accepted bounded failure/quarantine policy.
A missing winner/read timeout resumes the same message/operation; no infinite polling or new event ID.
Owner receipt retention must outlive the accepted replay horizon, or explicitly reject/quarantine expired evidence.
This bounded store fix requires no invented business migration; generation/checkpoint/audit models are separately accepted provider work.
D changes only its two stores/tests after entry is accepted; E owns shared consumer/harness/API/package changes.

### Six real DB controls: required independently, not run

Use separate real transactions/clients and an explicit read-absent barrier; timing sleeps/fake Inbox outcomes are insufficient.
Preserve actual error/constraint evidence privately, winner digest/effect, transaction rollback and actual broker ACK/NACK/quarantine disposition.
E allocates isolated databases/roles/queues and approved time bounds; test-only synchronization must not become a production bypass.

| Control | Store / setup | Required result |
| --- | --- | --- |
| D08-RHASH-01 | Reporting: two transactions observe no Inbox, same event ID, different valid payloads | exactly one committed hash/effect; loser is CONFLICT, no second effect or duplicate ACK |
| D08-RHASH-02 | Reporting: same absent-row race with identical bytes | one committed effect; legitimate loser DUPLICATE only after winner/hash validation; replay/restart adds no effect |
| D08-RHASH-03 | Reporting: fresh event ID, effect inserts occupied projection/contribution identity | unrelated actual uniqueness failure rolls back new Inbox/effect; no false duplicate ACK or lost obligation |
| D08-CHASH-01 | Communications: two absent-row transactions, same ID, different valid bytes | one committed hash/effect; loser conflict and approved quarantine; no second intent or false delivery |
| D08-CHASH-02 | Communications: concurrent same ID and identical bytes | one local effect; verified benign duplicate/replay, no extra intent/attempt |
| D08-CHASH-03 | Communications: fresh event ID, occupied notification/message/effect identity | actual unrelated uniqueness failure; full rollback and accepted failure/recovery, never duplicate ACK |

Current probe constraints can provide real primitive negative controls without inventing business tables.
The normal workers use upsert, so deliberately execute a real conflicting insert through the actual effect transaction for RHASH/CHASH-03.
Record which supported driver path exposes P2002/23505 and its constraint metadata; synthetic thrown codes do not replace this DB evidence.
When real business models exist, repeat relevant effect/checkpoint/audit invariants against those accepted schemas.
Current probes have no business checkpoint/audit; do not assert that a nonexistent field passed a test.
Complement the six controls with winner rollback/loser continuation, missing-winner lookup failure and commit-before-ACK termination/redelivery.
Those tests need awaited owned cleanup and durable before/after receipts; a process exit or mock callback is not successful recovery.

### E-owned digest profile prerequisite

Current InboxConsumer decodes the Buffer as UTF-8, parses JSON and hashes the decoded string via SHA-256.
It does not hash the original Buffer or enforce a published strict wire-encoding/size profile before decoding.
Request E's accepted original-byte/strict-UTF-8 policy, bounded message size and digest compatibility behavior.
Malformed encoding, oversized payload and changed original bytes must have an explicit rejection/quarantine outcome.
For accepted valid UTF-8 the compatibility proof must preserve existing digests; historical invalid bytes require an owner-reviewed disposition.
Do not silently reinterpret old receipts, rewrite payloads or declare a raw-byte protocol already implemented.
This profile and producer authentication/topology remain shared prerequisites, not extra D-owned shared edits.

## 4. Private evidence, exports, links and injection

C Media owns object bytes, purpose/relationship binding, quarantine/scan/finalization, retention and later retrieval.
D stores only accepted references and reviewed revisions; Support/chat/moderation/proof/privacy-export purposes are distinct.
An uploaded/quarantined object is not usable evidence; each later read verifies current actor, business binding and object state.
Never accept an arbitrary URL/path, finance-purpose object or browser-created room as a private attachment grant.
Current subject/purpose authority is rechecked after revocation/reassignment and at scan/finalization/retrieval boundaries.
New upload/download/preview capabilities require actual C/E providers; locked prototype imagery proves neither storage nor authorization.

Durable export jobs pin reviewed query/fieldset/purpose/format, exact source/generation/watermark selection,
current requester scope, policy/retention version, fingerprint, own revision/status and nullable private artifact metadata.
A owns customer CSV data/field permissions; D Reporting is a proposed report-job owner; E/owners must approve exact export coordination.
An artifact becomes READY only after actual private finalization/usable scan state, checksum and accepted complete/partial manifest.
Queued, unknown, partial, failed, cancelled, ready and expired remain different facts; READY is not privacy fulfillment complete.
A lost Media reply looks up the same upload/finalization operation; no repeated artifact or public-link fallback.
Authorization applies at initiation, source page, restart, publication/status and download, including revoke/expiry after readiness.
A historical approval or reusable link cannot override current authority; E/C must publish the actual safe retrieval contract.
Do not put signed links in broker events, logs, UI caches shared across users, repository evidence or generic audit.
Private response/cache policy and download filenames/headers are validated by accepted bounded transport, not raw user text.
Cancellation fences unsent/unbuilt work; actual downloaded/provider/backed-up copies cannot be claimed universally recalled.

CSV tests verify content/scope and safe text cells for =, +, -, @ and leading whitespace/control-prefix variants.
Quoting alone does not prevent formula evaluation; accepted neutralization must preserve approved phone/numeric/source meaning.
PDF rendering uses approved passive content/fonts/RTL and bounds; no script, active attachment or arbitrary remote fetch.
Chat/review/case/template content is plain text or an explicitly accepted safe rendering grammar, never trusted HTML.
Reject undeclared template parameters, unsafe field names, executable links and prototype-pollution inputs under closed schemas.
If any rich markup is approved later, publish its exact sanitizer/URL/attribute policy and prove rendering rather than assuming escaping suffices.
Filename/path traversal, CRLF/header injection, encoded variants and cross-object references have denied controls plus permitted positive controls.
Do not call those absent-provider tests passing or assert an exploit in the current inert prototype.

## 5. Privacy, redaction and audited scope

Current required fulfillment stays with each data owner under an approved coordinator and action/class/result mapping.
No global delete, implied automated executor, fabricated statutory period or D-owned financial erasure is proposed.
Retain B financial history under its approved policy; redaction/anonymization never deletes postings or breaks reconciliation lineage.
Actual request, verified subject/delegation, owner task/result, retained/blocked category, hold/policy and secure artifact remain independently scoped.
Intake received, per-owner accepted, export ready, partial/retained exception and completed fulfillment are separate outcomes.
Approved manual versus automated responsibilities, queue/reviewer/escalation/deadline and completion evidence are explicit policy inputs.
Missing required owner execution cannot be hidden behind receipt/status UI or a new W08 fault packet.

Replay/rebuild/restore must apply current suppression/tombstone/privacy-mask revisions to old events, snapshots and artifacts.
Approved obligations cover projections, exports, caches, private DLQ bodies, logs/audit, provider copies, backups and restore filtering.
Raw RabbitMQ bodies remain private retained data; dead-lettering does not sanitize them or finish owner work.
Keep current masks across interrupted/competing rebuilds and late corrections; old source events cannot restore erased eligible fields.
Historical finance, moderation and case evidence have independent approved retention/hold rules and minimized public fieldsets.
Sensitive audit records capture bounded actor/action/object/purpose/reason/revision/disposition, not message text or private evidence.
Audit/search/download scopes cannot be expanded by Reporting history or by a generic employee role.

Current logging already bounds depth/array/property/string values, redacts sensitive-named fields/credentials/buffers,
avoids accessors and masks Error details; current metrics collapse arbitrary paths into bounded technical route/outcome labels.
These protections do not authorize arbitrary personal text under a neutral field name or guarantee every trace/export is minimized.
D emitters use an explicit safe-field allowlist; no contacts, plates, addresses, evidence/QR, message bodies, raw provider results or URLs.
Metric labels omit user/Booking/case/object IDs; operational correlation IDs are separate bounded audit references under retention.
Test canary sensitive fields across nested logs/errors/traces/audit/DLQ metadata/download errors and allowed safe positive fields.
E owns shared logging/telemetry fixes; D owns its event/field selection and actual service emitters.

## 6. Resource limits, pending same-operation recovery and projection repair

Freeze an approved per-operation resource profile: body/text/depth/array/filter/page/row/byte limits, query interval,
artifact size, attachment count/type, worker concurrency, per-actor/market/global queue/fanout quotas and retention/retry budgets.
Gateway timeout/response ranges, broker delivery ceiling and outbox batch/lease defaults are technical controls, not approved business SLOs.
Publish realistic workload mix/data size/concurrency/duration, fault model, freshness/RPO/RTO/error/latency targets and decision provenance.
Until those inputs exist, hardening/load acceptance is blocked; no selected numeric budget or diagnostic duration becomes a performance claim.
Future queries compile closed filters against accepted indexed owner/projection fields; no arbitrary SQL/unbounded scan or regex.
Exports stream/page within accepted memory/disk/CPU limits; report jobs and cancelled work release only owned resources with audited outcome.
Bulk audience is reviewable and immutable by digest/version; apply current permission/consent/recipient checks per dispatch item.
Marketing opt-out suppresses eligible unsent sends; in-flight/unknown delivery cannot be declared cancelled or unsent after timeout.
Each logical notification/attempt retains original identity and bounded outcome lookup; OTP proves no SMS/provider capability.
Private history/reconnect cursors bind viewer/membership generation/query/retention, with explicit gaps and current reauthorization.

Support remedy timeout resumes the same B refund operation; D case resolution never reports confirmed money locally.
B owns partial refund cap/UNKNOWN allowance and immutable postings; received, allocation, refunded, custody and settlement stay distinct.
Booking, capacity, assignment, benefit and financial compensation converge through their respective owners, not Reporting or Gateway.
Reviews/moderation/template/config/export lost replies recover their original operation/revision/fingerprint before retry.
A fresh idempotency value cannot evade cross-key business uniqueness, unresolved owner result or current authorization.
Publish safe pending phase/source refs, error class, bounded retry/deadline, recovery owner and permitted next action.
Downstream outage must not create a new refund, capacity hold, review publication, notification attempt or fabricated zero metric.

Reporting applies receipt/effect/contribution/checkpoint atomically under accepted aggregate order/correction rules.
Durable pending gaps differ from applied frontiers; owner history/snapshots repair gaps without peer SQL or source mutations.
Rebuild uses a separate application generation, verified owner high-waters/privacy masks, live catch-up and fenced atomic pointer switch.
Retaining old Inbox can suppress rebuild; erasing receipts can duplicate source effects—neither is an accepted reset strategy.
Replay alters views only; no historical message resend, refund, benefit restoration, work resurrection or review publication.
Freshness exposes source vector/coverage/gaps independently of technical health; stale views cannot grant current business rights.
Configuration publishes typed reviewed versions with A/B/C validation, CAS/effective fencing and observed/applied consumer outcomes.
Rollback publishes a new compatible version; settings never retroactively change snapshots, ledgers or Identity grants.

## 7. Bounded sequence and truthful acceptance

1. E/owners accept current source/base, threat/retention/workload policies, exact schemas/grants/error/byte profiles and isolated resources.
2. D accepts the narrow two-store correctness child with the six real DB controls; E accepts corresponding shared harness/digest/topology work.
3. A/B/C/D publish narrow real current-authority, outcome/history, private Media and binding providers; none requires a live Reporting consumer.
4. D implements its accepted case/review/communication/export/config/rebuild consumers against those merged providers.
5. A/C/D prove full affected customer/operator/admin journeys and all current matrix actions before consumer/integration merge.
6. E serializes latest-target candidates and actual resulting-target checks, preserves mandatory CI and obtains eligible independent review.
All child names/sequence are proposals; no moving peer implementation, fixture provider or skipped case closes the parent gate.
Six Inbox controls, actual broker replay/restart/recovery, privacy-safe generation catch-up, scoped exports/injection,
revocation races, bounded fanout and real measured workloads are independent evidence categories.
Owned fault cleanup must be awaited even on timeout/cancellation; never start the next heavy case while recovery still mutates its resources.
Record actual process/container/worker/lease handles and residual owner state; no shared stack reset, broad kill or production fault is inferred.
Use isolated synthetic recipients/data and actual services; live provider/money or destructive production authorization is not supplied here.
Current electronic payment/provider scope, Paymera disposition and communication channels require actual owner evidence, not a fourth method.

Existing Reporting/Communications/Support scripts expose generate/build/build:tests/typecheck/migrate:deploy/start, no test:runtime.
Reviews/Configuration test:runtime executes foundation Nest tests; admin/operator test:runtime is foundation boot, customer has none.
Root exposes check:design-reference, check:migrations, test:contracts, test:nest, test:integration and acceptance:preflight/acceptance:run.
Current configured pins remain Node 24.21.0 and pnpm 10.32.1; no runtime verification is claimed by this file.
E must publish exact new domain/race/provider/browser/load commands and explicit all-three-app build/typecheck gates.
Existing root build/typecheck does not itself cover the three frontend applications.
Preserve frozen seven customer steps, guest/optional plate, references, RTL/motion/focus and exact pixel gates.
Missing English/LTR, recovery/private detail/export/security states need explicit approved designs; no reference or tolerance is changed.
No test, guard, runtime, installation, provider call, migration, staging, commit, GitHub write or production exercise was executed by this author.
No new process handles, real/mocked runtime results, scanner closure, performance percentile or accepted contract version exists to report.
Parent remains NOT_STARTED / INTEGRATION_PENDING; entry and required real cases block DONE/full launch.
Next action: E and owners review this proposal, resolve the inputs and publish a verified base/gates before bounded implementation.
