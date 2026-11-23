# W06-D Support, Reviews and Communications plan

Status: **UNACCEPTED lane-local proposal; implementation entry blocked**.
This document specifies bounded future D work. It implements no service, migration, client or policy.
Observed target: `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`.
Observed target tree: `c5bd3137ef9d4e0ab7b70b9646e126f10e011883`.
Neither value is BASE_W06. The conditional Day 4 PM milestone is not an acceptance claim.

## 1. Current evidence and write boundary

`architecture/parallel-contract-release.json` remains W01 / INTEGRATION_PENDING.
It records BASE_W02 as null, no BASE_W06, no accepted next-wave contracts and no existing clients.
`privacyCoordinatingOwner` and `retentionAnonymizationPolicy` are null.
The observed packages are contracts 0.0.2, event-contracts 0.0.2 and api-clients 0.0.1.
Those package numbers do not identify accepted W06 APIs; the client entry point exports no clients.
Identity foundation and Gateway transport exist; FoundationProbe is a runtime event, not a business workflow.
The strict BookingConfirmed contract and catalog event names do not prove a completed-service provider.
The preceding 36-path source delta contains CI/security and lane proposal/specification changes, with zero product-source changes.
Merged A/B/C/E W05 packets are dependency requests, not producer acceptance evidence.
Inputs: `docs/parallel/A/W05/W06_CONTRACT_REQUESTS.md`, `docs/parallel/B/W05/W06_CONTRACT_REQUESTS.md`,
`docs/parallel/C/W05/W06_CONTRACT_REQUESTS.md`, `docs/parallel/E/W05/W06_CONTRACT_REQUESTS.md`
and D's `docs/parallel/D/W05/W06_CONTRACT_REQUESTS.md`; earlier coordinator proposal is W01 CP-D-004.

| Current source | What actually exists | Missing W06 implementation |
| --- | --- | --- |
| `services/support/prisma/schema.prisma` | ServiceMarker only | cases, case_events, resolution_requests, HTTP commands |
| `services/reviews/prisma/schema.prisma` | ServiceMarker only | reviews, moderation, eligibility consumer, publication |
| `services/communications/prisma/schema.prisma` | ServiceMarker, InboxMessage, ProbeNotification | notifications, attempts, conversations, messages, templates |
| `services/reporting/prisma/schema.prisma` | ServiceMarker, InboxMessage, ProbeProjection | business projections, checkpoints, corrected ratings |
| D service `src/app.module.ts` files | foundation modules; BUSINESS_READY false | actual business readiness and owner authorization |
| `services/communications/src/inbox/consumer.runner.ts` | FoundationProbe parser and local probe effect | business events, delivery workers, membership reconciliation |
| `apps/admin-web/src/index.ts` | foundation-only runtime | functional disputes, customer reviews and notifications |
| Media, Booking and Customer Prisma schemas | marker-only business foundation | private objects, current beneficiary/completion, current consent |

Existing migrations remain append-only: Support/Communications/Reporting use `20260920000000_sprint_02_foundation`.
Reviews has `20261005060000_w01_foundation`; this plan adds no migration identifier.
Catalog ownership, not the older ten-service grouping, controls data boundaries.
D future code is limited to its permanent service/app paths and lane-local material.
E owns package manifests, lockfiles, TypeScript/Docker configuration, shared contracts/clients, Gateway, Identity and infrastructure.
The W06 task declares the W01 bootstrap lease expired; the stale registry still describes verified BASE_W02 expiry.
E must reconcile the effective registry and permanent-path inventory before any source writes; no lease is inferred here.
This document is the sole assigned write and does not change any source or shared ownership file.

## 2. Real transport, member/guest scope and shared contract requests

`packages/contracts/src/gateway.ts` declares GET `/api/v1/admin/support` routed to Support cases.
Its existing `support.cases.read` grant does not create the absent Support provider.
POST `/api/v1/admin/reviews/:id` routes to Workforce verification with `verification.review`.
It is KYC review, not customer-review moderation; do not repurpose that accepted route or permission.
The declared Billing refund route carries `billing.refund` and an idempotency header, not a live refund implementation.
The Gateway owner union omits Reviews, Communications and Media; no public W06 commands or clients are exported.
`apps/api-gateway/src/domain/policy.ts` rejects paths containing a query string; cursors need an accepted transport extension.
Current Identity has account-bound sessions and existing support, finance, operations and verification grants.
Preserve those grants; propose finer case assignment, privacy, moderation, template and bulk-send permissions through E.
No existing role grants object ownership or all private evidence purposes automatically.
No guest Support/review/conversation authority can be inferred from current account sessions or prototype guest booking.
E must publish bounded verified guest authority, expiry, recovery and current revocation behavior with C/A object binding.
Each owner rechecks the current actor, subject/delegation, object, purpose and granted action on every command/read.
Browser room names, phone numbers, IDs, role claims and a Gateway header alone are never authorization.

All schema names and fields below are proposals; E assigns exact exported schemas, routes and versions at acceptance.
Common commands carry a stable operation identity, current actor context, correlation identity and typed business references.
Each reference names its owner, object ID and required owner revision; revisions are not interchangeable across services.
D command revisions apply only to D records; immutable source snapshots record their independently named revisions.
Use opaque owner-issued IDs, UTC instants and explicit policy versions; server time decides expiry and scheduling.
Timeout, retry budget, operation-retention horizon and accepted numeric bounds must be published, not guessed.
Refund money uses B's accepted exact amount/currency representation; D neither converts currency nor calculates a new ledger.
Persist a canonical fingerprint over validated command fields, scope, purpose and relevant policy/source revisions.
Scope idempotency to owner, operation kind, authenticated actor/delegation and logical business identity.
Same identity and fingerprint replays the original durable operation/outcome; changed input conflicts.
Transport replay retention may be finite only under an approved horizon; unique logical effects outlive that cache.
Publish scoped operation lookup for lost replies, restarts and UNKNOWN outcomes before consumers implement retry.
Never replace an unresolved command with a new operation identity to escape an unknown result.
Proposed errors distinguish current-authority denial, expiry, revision/fingerprint conflict, ineligible source, unsafe media,
policy/consent rejection, bounded-rate rejection, unavailable owner, pending operation and unknown outcome.
Responses expose safe owner operation references and retry advice, never internal account bindings or private content.
E must map those semantics through Gateway; current coarse conflict/validation/upstream mappings are insufficient evidence.
Strict existing contracts remain unchanged; new families require provider/consumer compatibility fixtures and additive exports.

## 3. Support: durable cases and independent remedies

Proposed `cases`: caseId, beneficiary binding, optional Booking reference, category, current status/revision,
assignment revision, assigned staff reference, priority, policy revision, creation/update instants and retention classification.
Proposed `case_events`: eventId, caseId, sequence, actor reference, action, reason code, before/after revisions,
visibility classification, source references and occurrence time; history is append-only under its retention policy.
Proposed `resolution_requests`: resolutionId, caseId, expected case revision, kind, reason/policy revision,
evidence references/revisions, approval record, own state/revision and nullable B operation/result references.
Public case history, private evidence links and internal staff notes require separate authorized fieldsets.
Creation verifies current beneficiary/guest authority and the actual related Booking; unrelated operators cannot create ownership.
The case creation operation is deduplicated durably; a retry cannot open an extra case or notify twice.
Triage, assignment, reassignment, escalation, resolution and reopening use compare-and-set on the correct D revision.
Record actor and reason for every transition; assignment does not replace purpose-specific evidence permission.
Staff revocation immediately prevents further reads/writes; reassignment removes the old assignee's case-purpose authority.
Escalation targets, severity rules, response deadlines and reopen limits are approved inputs, not invented timers.
Candidate case states OPEN, TRIAGED, IN_PROGRESS, ESCALATED, RESOLVED and CLOSED require policy acceptance.
Resolution kind/state is separate from case state; a nonfinancial decision must not imply a payment or service correction.
Nonfinancial remedies need approved allowed actions and any C/A owner commands; Support does not write their records.
An optimistic-conflict response returns a safe current revision; it does not silently overwrite another decision.
Evidence append/remove and resolution approval must record which Media and policy revisions were actually reviewed.

For a financial remedy, D creates one durable resolution request and one stable case-resolution refund identity.
The B command identifies actual Booking/payment/receipt references, beneficiary, reason, policy, approved amount and evidence revisions.
B rechecks financial permission, available refundable amount, existing/in-flight operations and source verification.
Support's case permission is not B refund permission; any delegated service command needs an accepted E/B authority contract.
B returns its actual operation identity and accepted, pending, unknown, rejected or confirmed outcome as published.
D records that result separately from case closure; only B's authoritative result may display refunded money.
Partial refunds, prior refunds and unresolved attempts must stay visible; B reserves in-flight allowance rather than freeing it on timeout.
A lost reply triggers lookup/replay of the same B operation, never a second refund or D ledger posting.
Downstream outage leaves the D request pending/unknown with a recovery owner and bounded retry policy.
If a case closes before the remedy settles, the UI explicitly shows both facts and the remaining financial operation.
No Support action cancels capacity, recreates work, withdraws funds or compensates a Booking implicitly.

## 4. Privacy: approved intake, owner fulfillment and retained records

A owns the customer privacy surface; the coordinator/server authority remains an explicit E/product decision.
W01 CP-D-004 proposed Support as coordinator, but it is still unaccepted and the release value is null.
Do not treat D assignment in this plan as an accepted privacy authority or create a new privacy service.
A/W05 requests W06 per-owner fulfillment; B/W05 reserves financial fulfillment for W07.
That timing/scope conflict must be resolved by A/B/D/E and product before W06 scope can be accepted.
The required intake/status and accurate retained-record fulfillment cannot be silently deferred or relabeled complete.
Resolve D's proposed ACCESS/RECTIFICATION/ERASURE/RESTRICTION versus B EXPORT/DELETE/ANONYMIZE and A's open owner action map.
Resolve whether fulfillment is manual, automated or a bounded mixture, with named owner queues, verifier/reviewer roles,
handoff, due-date policy, secure artifact return, retry/escalation and completion evidence for each supported action.
A manually executed owner workflow can be valid only with those accepted responsibilities and real audited outcomes.
This plan promises neither automated fulfillment nor universal deletion; missing required owner execution remains a full-scope blocker.

Candidate intake fields: requestId, current verified subject/delegation, assurance reference, action, scope classes,
policy revision, submitted time, revision and separately scoped operation/status references.
Candidate owner task: taskId, requestId, owner, verified subject binding, action/purpose, expected policy/source revisions,
approved deadline and current grant; no browser-supplied subject substitution or cross-database command.
Candidate owner result: resultId, taskId, actual action/state, affected scope/revision, retained categories,
hold/policy reasons, failure/retry data, evidence digest and nullable secure artifact metadata.
An unfinished result has no fictional completion time, export artifact, purge confirmation or performed-action reference.
RECEIVED, VERIFYING, OWNER_PENDING, PARTIAL, BLOCKED, FAILED and COMPLETED remain distinguishable proposed states.
Only accepted required owner results can close the aggregate; HTTP acceptance or a broker ACK is not fulfillment.
Status reads recheck current verified subject and purpose, including expired guest authority and delegated staff revocation.
Account closure and E session/grant revocation are separate from physical erasure and request fulfillment.

| Data owner | Required owner-specific fulfillment boundary |
| --- | --- |
| A Customer/Vehicle/Geo | approved profile, consent, vehicle/address/location scope; live relationship checks |
| B Billing/Wallet/Subscription | lawful approved holds and immutable historical financial records; explicit retained categories |
| C Booking/Scheduling/Dispatch/Workforce | operational/history retention; no privacy-triggered cancellation or rewritten completion |
| C Media | private originals, derivatives, quarantine, export artifacts and approved purge evidence |
| D Support/Reviews/Communications/Reporting | case/moderation/message/projection fields and their independent retention purposes |
| E Identity | approved account/session/grant/cache actions; assurance and current requester authority |

Retain financial posting history under the approved B policy; owner-specific redaction/anonymization must preserve reconciliation.
Configuration may publish approved typed policy versions, never invent the legal basis, retention duration or hold decision.
Cover audit/logs/traces, caches, derived projections, DLQ payloads, exports, provider copies, backups and restore handling.
Approved tombstones/restoration filtering must prevent replay or recovery from recreating erased eligible personal fields.
Retained-by-policy, logical action complete, purge pending, purged and unknown disposition are different facts.
A business snapshot is not a complete subject-access export; JSON without Media bytes cannot fulfill a requested binary class.
An export requires a real owner manifest, checksums, declared scope/omissions, private artifact and expiring current-authority retrieval.
Sensitive export initiation and later retrieval are audited separately; no files, credentials or raw evidence in the audit event.
No prototype local JSON/reset, empty export, unperformed purge or invented statutory date can satisfy this workflow.

## 5. Reviews: actual eligibility, moderation and corrected publication

C must first publish a real completed-service eligibility read with Booking/completion identity and revisions,
current beneficiary binding, correction/revocation behavior and any separately approved payment/cancellation conditions.
Booking confirmation, a proof image, payment receipt or a prototype completion screen is not completed-service eligibility.
Neither C/W05 requests nor the accepted foundation exports currently supply that provider.
Reviews validates current member/approved guest ownership; operator, reviewer and unrelated customer cannot submit on the beneficiary's behalf.
Publish guest eligibility duration/recovery and whether one Booking or one completion is the canonical reviewable unit.
Proposed `reviews`: reviewId, canonical eligible unit/beneficiary context, completion revision, author-private binding,
rating, nullable plain text, content revision, eligibility/publication state, policy revision and timestamps.
Proposed `review_moderation_cases`: moderationId, reviewId, expected content/state revisions, actor/reason/policy,
evidence references, decision history and revision; private evidence is never copied into the public review.
Use a database uniqueness constraint on the accepted canonical unit and beneficiary context, including guest/member conversion.
Uniqueness is independent of a short-lived replay cache; edits, withdrawal or a second account binding cannot create duplicates.
A/W05 proposes rating 1–5 and nullable text; bounds, edit window, attribution, appeals and retention remain product inputs.
An edit creates a new content revision under the approved policy and may require renewed eligibility/moderation.
Moderators may decide publication/retraction with reason and current finer scope; they cannot silently rewrite rating/text.
`verification.review` remains Workforce KYC authority and cannot authorize this new moderation workflow.
Concurrent decisions compare expected review and moderation revisions; one wins and the other conflicts without duplicate publication.
Candidate states PENDING_VERIFICATION, PENDING_MODERATION, PUBLISHED, HIDDEN, REJECTED and WITHDRAWN need accepted transitions.
Publication requires actual eligibility and accepted moderation policy; publication time is absent until that transition commits.
If completion is corrected or withdrawn, record a durable recheck/hold/retraction outcome rather than preserving false verified status.
Public views omit private author IDs, Booking references, contacts, plate/address and evidence; optional attribution needs its own policy.
Publish/retract/correct events carry review ID, publication revision, eligible unit reference and minimal approved contribution data.
Reporting applies one current contribution per review: remove prior count/sum, then add the new eligible published contribution atomically.
Do not increment blindly on replay or average averages; corrected historical totals require exact sum/count and visible freshness.
Pending/private moderation queues stay separate from public ratings; missing or stale eligibility cannot be represented as verified.

## 6. Communications: membership, history and durable delivery

C Booking/Dispatch owns current beneficiary and assignment relationships, not conversation tables or chat memberships.
D proposes Communications-owned `participantRef`, `membershipGeneration` and membership records alongside its conversations/messages/receipts.
E Identity owns the current authenticated subject/session/grants; server-private binding maps that subject to a D participant.
This aligns with A/W05's proposed Communications-owned references; ownership/generation contracts remain unpublished.
Older D requests for a C participant-access event are unaccepted.
C supplies accepted relationship assertions/reads/corrections; D computes its purpose-scoped membership from those facts.
Support supplies case-purpose staff/beneficiary authority; browser room membership and stale events never create a grant.
First accept a narrow D conversation/case binding provider, then purpose-specific C Media, then message/evidence consumers.
Public participant views contain only opaque D references, approved role/label and the viewer's own safe actions/revision/expiry.
Never return another participant's Identity subject, complete permission set or private beneficiary mapping.
Membership revocation/reassignment advances D generation; reads, sends, receipts, attachment retrieval and reconnect recheck current authority.
Unavailable relationship/Identity authority fails closed or exposes an approved pending state, without granting stale membership.

Proposed `conversations`: conversationId, typed Booking/case binding, state/revision, membership generation,
latest committed sequence and retention policy; internal staff-only conversations/notes use separate authorized scope.
Proposed `messages`: messageId, conversationId, clientMessageId, sender participant, sequence, content revision,
plain-text or Media reference payload, accepted time and redaction state; retained sequence can survive content removal.
Proposed membership/receipt records bind participant, generation, allowed purposes, expiry and monotonic read-through sequence.
Send verifies current membership, expected generation, kind, typed limits and scanned purpose-bound Media references.
The unique sender/conversation/clientMessageId fingerprint yields the original durable message on lost-reply replay.
Persist message, sequence allocation, audit and outbox in one transaction before any broadcast or acceptance receipt.
History cursors bind conversation, viewer, membership generation, query and bounded ordering; no cross-room cursor reuse.
Reconnect reads a bounded authoritative snapshot and resumes via an accepted race-closing protocol; gaps and expired retention are explicit.
Read-through is monotonic, belongs to the current participant and cannot exceed the visible committed sequence.
Browser receipt is a separate per-recipient fact; it does not prove reading or external delivery.

Proposed `notifications`: notificationId, purpose, origin operation/event, recipient binding, channel,
immutable template version, validated parameters, audience revision/digest, schedule/expiry, policy and own revision/state.
Proposed `delivery_attempts`: attemptId, notificationId, attempt ordinal, provider operation/callback identity,
dispatch state, outcome revision, safe error/retry data and timestamps; UNKNOWN survives restarts.
Templates require immutable publication versions, approved Arabic/other locale copy and closed typed parameter schemas.
Render plain text/escaped content; reject undeclared fields, markup/URL injection and private material for an unapproved purpose.
Template retirement prevents new use under approved policy; a scheduled item remains pinned to its reviewed version or is explicitly cancelled.
Operational notices and optional marketing use separate approved purpose/consent rules; refusal cannot block essential service transactions.
A's current consent/contact revision and the current recipient relationship are rechecked before dispatch, not inferred from old events.
Consent withdrawal before scheduled dispatch suppresses/cancels the eligible unsent item with a durable reason.
Scheduler claim/cancel and attempt creation need revision/fencing constraints; a winning cancellation prevents a later send.
If provider dispatch is already in flight, cancellation cannot promise recall; record pending/unknown reconciliation honestly.
Bulk preview records permitted purpose, filters, deduplicated recipients, exclusions, count and audience digest/revision.
Approval/permission covers that exact audience and template version; changed selection needs review again and current per-recipient checks.
Use only isolated synthetic recipients in acceptance; no real bulk messages, provider credentials or SMS capability is assumed.
Current OTP delivery proves neither Communications SMS capability nor any channel's delivery/callback contract.
Provider selection, sandbox policy, callback authentication, retry/expiry and reconciliation capability require actual evidence and approval.

SCHEDULED, durable ACCEPTED, provider acceptance, DELIVERED, browser receipt, READ, FAILED and CANCELLED are separate proposed facts.
Accepted means the owned record committed; delivered needs an authenticated supported transport outcome; read needs current recipient action.
Unknown provider outcome is not FAILED, and positive broker/publisher confirmation is not user delivery.
Retry uses the same logical send/provider identity where supported; unsupported deduplication requires a bounded unknown-outcome policy.
Callbacks deduplicate and apply their owner outcome revision without regressing terminal facts on replay/reorder.
Notifications retain delivery history and template/audience provenance under policy; counts cannot equate queued, attempted and delivered.

## 7. Private Media, atomic audit and repair prerequisites

C Media remains sole object/byte/scan/retention authority; D stores only scoped references and reviewed revisions.
Each reservation/read names private purpose, business binding, object revision, current actor and approved owner/subject relationship.
Support evidence, chat attachments, moderation evidence, payment proofs and privacy artifacts are distinct purposes.
Successful upload alone is not scanned/accepted evidence; quarantine, rejection, expiry and deletion invalidate eligible use explicitly.
Every later byte read rechecks current authority; do not reuse finance-purpose objects or accept arbitrary URLs as attachments.
E must publish real bounded Media transport and safe headers; current JSON Gateway forwarding is not a private byte-stream provider.
Do not include signed URLs, raw bodies, private participant bindings or evidence bytes in events/logs/audit.
Persist D command receipt, local transition, immutable actor/reason audit and outbox atomically; ACK only after Inbox/effect commit.
Cross-owner success is linked by actual operation/result IDs, not simulated by a local transaction or broker ACK.
Consumer checkpoints track per-source aggregate revision and applied event identity; gaps trigger an accepted bounded owner read.
Expose as-of time, source revision, pending gaps and quality; a projection never supplies current authorization or money truth.
Rebuilds use accepted owner snapshots/corrections and privacy tombstones; never resend messages, refunds or prior publication side effects.

INT-D-01 remains a **static risk, not reproduced and not fixed by this proposal**.
Both D `src/inbox/prisma-inbox.store.ts` files compare an existing hash, but catch any P2002/23505 as DUPLICATE.
`packages/platform-messaging/src/inbox-consumer.ts` ACKs that outcome, including potentially unrelated effect uniqueness failures.
Concurrent absent-row deliveries with different bytes can bypass the intended winning-hash comparison.
Future D fix must identify the Inbox event-ID constraint, roll back, reread the winner in a fresh transaction and compare its original-byte digest.
No winner/unrelated uniqueness error must not be classified as a duplicate ACK; changed bytes require conflict/quarantine.
The existing sequential changed-payload integration case and fake Inbox outcomes do not prove that concurrency branch safe.
Require real concurrent same-ID/same-bytes and changed-bytes cases, unrelated effect-constraint rollback, crash-after-commit/redelivery and checkpoint atomicity.
E must first publish business topology, intended durable subscriber bindings, ACLs, bounded retries/DLQ handling and recovery gates.
Foundation probe queues are not W06 business routing; broker recovery must not recreate erased content or authorize stale members.

## 8. Bounded provider-first children and acceptance

Child names below are sequencing proposals, not implemented commands, accepted versions or new wave bases.
1. E entry child: approved policies/design decisions, current Identity/guest scopes, Gateway/errors/cursors, contracts/clients and isolated resources.
2. A/C/B narrow providers: current consent/subject, completed-service/current relationships, and durable authorized refund/status recovery.
3. Narrow D binding/intake child: real case/conversation/member bindings and, under the accepted coordinator decision, verified privacy request/subject/purpose/task-binding intake/status. Prove owned DB/HTTP/current authorization without downstream private objects or owner fulfillment; no intake-only full-scope claim.
4. C Media child: real private objects/artifacts and scoped binding checks against the merged D provider; provider acceptance does not depend on the full downstream chat/privacy journey.
5. Required owner privacy executor children: actual approved action/status/retention receipts and private artifacts against merged verified request bindings and Media as applicable. No dependency on final aggregate completion UI.
6. Independent D product providers/consumers: real Support resolution requests/evidence/B outcomes, Reviews eligibility/submission/moderation and corrected projections, templates/messages/history/receipts/scheduling, plus final coordinator aggregation of real required owner results. Split these narrow providers further with E where needed; no peer fixture closes acceptance.
7. A/C/D app children: customer Support/reviews/privacy/chat, operator authorized chat and admin disputes/moderation/notifications against merged real owners.
8. E serialized candidate gate: latest target plus child head, unchanged refs, all mandatory checks and actual affected three-app journeys before consumer merge.
Every provider first proves its owned DB constraints/migration/HTTP/current-authority/contracts; no full downstream journey is required to create a cycle.
The consumer then proves its actual journey against that merged provider; fixtures remain explicitly local and cannot close integration acceptance.
The privacy timing conflict must be resolved at entry, not hidden by sequencing the required B result into an unapproved later wave.

Required scope cases include unrelated customer/operator denial for cases, messages, pending reviews and private bytes;
staff/session revocation, reassignment, expired guest recovery and scoped privacy status; duplicate case/refund/message and lost-reply recovery;
partial/unknown B refunds, incomplete/corrected service reviews, concurrent moderation and corrected rating totals;
event replay/reorder, retention/cursor gap, current membership after reconnect, template injection and opt-out before scheduled dispatch;
cancel/send races, provider unknown/callback replay, restart/downstream outage, exact bulk audience and isolated recipients;
owner-specific privacy partial/blocked/manual outcomes, retained financial history, private export retrieval and replay/restore tombstones.
Real customer, operator and admin journeys must run after serialized integration, with approved detail/composer/moderation states.
F010 registers three Arabic RTL references; DESIGN_LOCK/ADR historical full-admin/operator approval wording needs explicit reconciliation.
Preserve frozen references, seven separate customer steps, optional plate, motion/focus/RTL and current approved payment methods.
New production detail/error/composer/privacy/moderation/bulk states and full English/LTR approval are outstanding inputs, not invented designs.

Actual scripts: Support/Reviews/Communications/Reporting expose generate, build, build:tests, typecheck, migrate:deploy and start.
Only Reviews additionally has test:runtime, invoking its foundation Nest test; Support/Communications/Reporting have no such script.
All three apps expose build and typecheck; admin/operator have foundation test:runtime, while customer has no test:runtime.
Root has check:design-reference, check:migrations, test:contracts, test:nest, test:integration and acceptance:preflight/acceptance:run.
Existing script names do not supply the missing W06 test implementation; E must publish the exact affected gate commands/manifest.
Root build/typecheck omit app coverage, so explicit commands such as `pnpm --filter @carwash/admin-web run build`
and equivalent customer/operator commands must appear in the accepted gate, alongside actual new domain/provider/consumer/browser cases.
Verify pinned Node 24.21.0 and pnpm 10.32.1, approved migration identities, isolated DB/roles/queues/objects/ports and one heavy slot.
No install, build, migration, service, provider, browser or runtime test was executed for this document; no process handles were created.

## 9. Exit and future-only handoff

Parent status remains NOT_STARTED / INTEGRATION_PENDING; missing accepted BASE_W06, producers, policies and tests block DONE.
E/product must resolve privacy coordination/retention/fulfillment timing, guest assurance, finer grants, edit/moderation rules,
escalation, template/audience/consent/channel policy, new approved UI states and current source ownership before affected implementation.
Financial verification/provider readiness remains B's evidence; no live-money or provider facts are inferred from W05 proposals.
Reporting remains a D projection owner, with B authoritative financial reconciliation and C authoritative work/assignment facts.
W07 corrected metrics, audit/exports and remaining promotion/subscription/fleet/customer/configuration actions are **future proposals only**.
They need source-owner/E acceptance; they neither start W07 nor excuse a missing required W06 workflow.
Resume only on an E-published accepted base/contracts and the bounded task instruction; no self-approval, merge, deployment or automatic next wave.
