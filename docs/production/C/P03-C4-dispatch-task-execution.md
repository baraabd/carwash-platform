# P03-C4 — Dispatch: eligibility-checked offers and technician task execution

Child of P03-C (Lane C: Dispatch and the real technician job execution
application). One branch, one PR from `main@a14997a`; not stacked on any other
child. Parent status: **INTEGRATION_PENDING** until C1 (Workforce), C2 (Media),
C3 (Booking view), C4 (this) and C5 (operator-web) pass together on one merge
tree and Lane E publishes the requested contracts.

Cross-child interfaces: `P03-C-interfaces.md` (byte-identical in every child).

## What this child adds

1. **Eligibility from Workforce (published contracts only).**
   - Before an offer, before a reassignment and again before an acceptance, Dispatch reads the published
     workforce.v1 `listCapacityResources` for the job's zone and window. The resource must be
     listed, ELIGIBLE, and hold one shift covering the whole window.
   - Workforce failure is 503 `ELIGIBILITY_UNAVAILABLE`, never "eligible".
   - Dispatch also consumes the published `workforce.eligibility-changed.v1` (inbox, watermark per resource).
     A newer INELIGIBLE watermark beats an older ELIGIBLE read.
   - On INELIGIBLE, live offers and unstarted (ACCEPTED) tasks of the resource are withdrawn and the jobs return to
     operations. Tasks already in the field are **flagged** (`attentionReason`), never cancelled behind
     the technician.
2. **Task execution record** (decision P03-C-D1): created by the acceptance in the same transaction. Stage machine
   `ACCEPTED → EN_ROUTE → ARRIVED → IN_SERVICE → DOCUMENTING → FINISHED → CLOSED`, side exits
   `RELEASED` (technician, before departure), `WITHDRAWN` (reassign/unassign/eligibility),
   `CANCELLED` (slot released). It maps one-to-one onto the approved reference stages
   `accepted/route/before/wash/after/handoff/closed`.
3. **Evidence links** to Media objects (opaque ids): before/after × slot 0/1, one current link per slot, replacement kept
   in history. A Media object is linked at most once, ever.
4. **Checklist snapshot** `washgo.checklist.v1`: the four checks of the approved reference, all required.
   The per-service rule is an owner policy that is still pending.
5. **Handoff declaration.**
   - `CASH_COLLECTED{amount}`, `CASH_NOT_COLLECTED{reason}` or `NOT_CASH`, plus one late cash declaration after
     `CASH_NOT_COLLECTED`.
   - A declaration is **not** a receipt; Billing owns money (P03-B1 #111).
   - Money is exact: integer minor units as a string, explicit currency and scale, BIGINT in SQL, bigint in TS.
6. **Work evidence for Billing**: `GET /me/bookings/:bookingId/work` returns the caller's assignment, its revision and
   `workState` (`NOT_STARTED|IN_PROGRESS|COMPLETED|CANCELLED`). This is the Dispatch half of Billing's
   `WorkAuthority` (blocker B-P03-01); Booking supplies `quoteId`.
7. **Events** (outbox, producer-pending): `dispatch.task-progressed.v1` (every stage change) and
   `dispatch.cash-declared.v1`. Both carry opaque ids only.

## Architecture

```
transport/http        DispatchController (ops/offers), TaskController (technician tasks),
                      http-input (closed bodies), views, DispatchHttpFilter
transport/messaging   holdChangedConsumerParts, eligibilityChangedConsumerParts
application           DispatchService, TaskService, HoldChangeHandler, EligibilityChangeHandler,
                      Effects (outbox/audit/history), runIdempotent
domain                assignment, offer, task, eligibility, money, events (pure)
ports                 DispatchTransaction/UnitOfWork, DispatchReadModel, WorkforceCapacity, EvidenceObjects
infrastructure        PrismaDispatchStore (+ task-rows), WorkforceCapacityClient, MediaEvidenceClient,
                      ServiceHttp (timeouts, single jittered retry for idempotent calls), Identity client
```

`scripts/check-layers.mjs` passes. Domain, application and ports import no Nest, Prisma, pg or HTTP.

## Invariants and where they are enforced

| Invariant | Application | Database |
| --- | --- | --- |
| one task per accepted offer | acceptance | `UNIQUE (offer_id)` |
| ≤ 1 non-terminal task per assignment | releaseCurrent / handlers | partial `UNIQUE (assignment_id) WHERE stage NOT IN (RELEASED,WITHDRAWN,CANCELLED)` |
| a technician is in the field on ≤ 1 task | — | partial `UNIQUE (technician_subject) WHERE stage IN (EN_ROUTE..FINISHED)` → `TECHNICIAN_BUSY` |
| forward-only stages | domain rules | trigger `dispatch_task_guard` (`TASK_INVALID_TRANSITION`) |
| start needs a current BEFORE photo; finish needs AFTER; document needs every required check | domain | same trigger |
| stage ↔ timestamps, end reason, release reason | domain | CHECK constraints |
| CLOSED immutable except one late cash declaration | domain | trigger (`TASK_CLOSED_IMMUTABLE`) |
| identity columns immutable, version +1 per update | store | trigger |
| collection declaration consistency, exact money, currency/scale | domain + parser | `task_collection_ck`, `task_late_cash_ck` |
| a Media object linked once; one current link per slot | application | `UNIQUE (media_object_id)`, partial unique slot index |
| evidence links append-only (only `removed_at` may be set once) | — | trigger |
| notes and history append-only | — | triggers |
| completed work never reassigned/cancelled | releaseCurrent, hold handler | trigger refuses WITHDRAWN/CANCELLED from CLOSED |
| eligibility watermark only moves forward | `decideObservation` | upsert `WHERE revision < EXCLUDED.revision` |

### Fencing and race safety

- **Lock order:** idempotency record → hold observation | resource watermark → assignment(s) ascending →
  offer → task.
- Offer/reassign/accept take the per-resource watermark lock **shared** before the assignment lock. The eligibility
  consumer takes it **exclusive**, then the assignments. An event therefore either precedes an offer
  (the offer is refused) or sees it (and withdraws it).
- Every technician command locks the assignment, then the task. It answers 404 for someone else's task and
  409 `TASK_CLOSED` for a task that ended, then checks `expectedRevision` (412). A withdrawn
  technician can never advance a job: the task changed in the same transaction that withdrew it.
- Remote calls (Workforce, Media) happen **before** the transaction, never while holding row locks.

### Idempotency and replay

Same mechanism as P02-C3: scope = actor + operation + target, key 16–128 chars, canonical-body fingerprint,
7-day retention. A refusal that commits side effects (an expiry, or an ineligibility withdrawal) leaves no
record, so a retry is evaluated against the new state. Evidence claims use a deterministic
`claimRef = UUIDv8(sha256("dispatch.task-evidence:" + task + ":" + object))`, so a retried attach reuses the claim.

### Evidence saga (Dispatch ↔ Media)

1. Read the object from Media: AVAILABLE, owned by the caller, `WORK_EVIDENCE`, an image type.
2. Claim it in Media with the deterministic claimRef. The claim is idempotent.
3. Local transaction: link, update the task revision, history, audit.

If step 3 fails after step 2, the object stays claimed and is retained longer. That is the safe
direction for evidence, so no compensation is needed. Media outage gives 503 with nothing written; a retry
with the same key converges. **Media's API is requested, not published** (CR-P03-C2); parity is proven only
in the merge candidate.

## API additions (`/internal/v1/dispatch`, requested `dispatch.v1`)

Technician (`work.read:assigned` for GET; `work.execute:assigned` + `Idempotency-Key` + `expectedRevision`
for writes). The full list is in `P03-C-interfaces.md` §C4:

- `GET /me/jobs`
- `GET /me/tasks/:taskId`
- `GET /me/bookings/:bookingId/work`
- `POST /tasks/:id/{depart,arrive,start,document,finish,close,cash-collection,release,notes}`
- `PUT /tasks/:id/{condition-note,checklist/:code,evidence/:phase/:slot}`
- `DELETE /tasks/:id/evidence/:phase/:slot`

**Declared addition to the interface spec:** the task view (and the job-list summary) also carries
`endedAt`, `endReason` (`RELEASED_BY_TECHNICIAN|REASSIGNED|UNASSIGNED|RESOURCE_INELIGIBLE|JOB_CANCELLED`)
and `attentionReason` (`RESOURCE_INELIGIBLE`), so a technician app and operations can tell why a
job left the list and that field work was flagged. Found by the P03-C merge candidate; operator-web
(#118) accepts them as closed keys.

Accept now returns `taskId`; decline accepts an optional `note` (3–500 chars). Operations views now
include the live task's `{taskId, revision, stage, attentionReason}`.

Error mapping (shared envelope):

| HTTP | Code | Reasons |
| --- | --- | --- |
| 422 | `BUSINESS_RULE_VIOLATION` | `RESOURCE_INELIGIBLE`, `EVIDENCE_REQUIRED`, `EVIDENCE_INVALID`, `CHECKLIST_INCOMPLETE` |
| 409 | `CONFLICT` | `TASK_CLOSED`, `TASK_STAGE_INVALID`, `TECHNICIAN_BUSY`, `EVIDENCE_IN_USE`, `COLLECTION_NOT_OPEN` |
| 404 | `NOT_FOUND` | `TASK_NOT_FOUND`, `CHECK_NOT_FOUND` |
| 503 | `DEPENDENCY_UNAVAILABLE` | `ELIGIBILITY_UNAVAILABLE`, `EVIDENCE_UNAVAILABLE` (retryable, `retryAfterMs` 1000) |

## Configuration

Absent means unavailable (fail closed); partial or malformed refuses to start.

- `DISPATCH_WORKFORCE_URL`, `DISPATCH_WORKFORCE_CLIENT_ID`, `DISPATCH_WORKFORCE_CLIENT_TOKEN`,
  `DISPATCH_WORKFORCE_TIMEOUT_MS`.
- `DISPATCH_MEDIA_URL`, `DISPATCH_MEDIA_CLIENT_ID`, `DISPATCH_MEDIA_CLIENT_TOKEN`, `DISPATCH_MEDIA_TIMEOUT_MS`.

Timeout default 1500 ms (100–10000). One jittered retry, only for GET or declared-idempotent POST, and only
on timeout, network failure or 5xx. Response bodies are capped at 256 KiB.

## Migration

`services/dispatch/prisma/migrations/20261009120000_p03c4_task_execution`. It is expand-only:

- new tables `task`, `task_evidence`, `task_note`, `task_event`, `resource_observation`;
- new column `dispatch_offer.decline_note`;
- new index on `dispatch_offer(resource_id, status)`;
- three CHECKs replaced by strictly **wider** ones (withdraw reasons, idempotency result type, audit target type);
- trigger functions in schema `app` with `search_path = pg_catalog, pg_temp`.

Every value the previous image writes stays valid, so **rollback = redeploy the previous image**; the new
tables are then unused. Dropping them is a separate reviewed contract step with a backup. No data is migrated.
`prisma migrate diff` between the migrated database and `schema.prisma` reports an empty migration.

## Security and privacy

- Deny by default; permissions come from Identity's session view.
- Object access: someone else's task, offer or booking work gives 404, so ids cannot be probed.
- Dispatch stores no customer, address, vehicle, contact or price. The technician's cash declaration amount is
  the only money stored, and it is a claim to reconcile, not a price.
- Events and audit rows carry opaque ids. Notes and the condition note are technician free text kept in Dispatch
  (bounded, NFC, no control characters) and never evented.
- Outbound credentials are interim digests (CR-P02-C3 §4); never logged.

## Evidence

Produced by `node scripts/production/C/verify.mjs dispatch` on a clean tree. The exact head, tree, images and
counts are in the PR description.

| Family | Real dependency | Doubles | Suites |
| --- | --- | --- | --- |
| unit | none | — | `test/unit/domain.spec.ts`, `edge-security.spec.ts`, `task-domain.spec.ts` |
| postgres | PostgreSQL 16.10, runtime role, 2 pools | Workforce and Media **ports** (in-process) | `dispatch.pg.spec.ts`, `task.pg.spec.ts` |
| http | real Nest + PostgreSQL | Identity session, Workforce capacity-resources (published shape), Media object/claim (requested shape) over HTTP | `http.pg.spec.ts`, `task-http.pg.spec.ts` |
| contract | built `@carwash/contracts`, `@carwash/event-contracts` | — | `dispatch-contract.test.mjs`, `dispatch-workforce-contract.test.mjs` (20-sample parity corpus) |
| broker | RabbitMQ 4.2 quorum + DLX, shared `InboxConsumer`/`OutboxRelay` | — | `dispatch-inbox-rabbitmq`, `dispatch-eligibility-rabbitmq`, `dispatch-outbox-rabbitmq` (task-progressed relayed) |
| restart | compiled API/worker, SIGKILL, PostgreSQL restart | Workforce HTTP double | `dispatch-restart.test.mjs` |

Required P03-C behaviours covered here:

- **two technicians accepting the same offer:** the addressee wins exactly once and the others get 404. Concurrent
  double-accept by the addressee from two replicas yields one task.
- **accept vs reassign race:** one consistent outcome, never two live tasks.
- **reassignment mid-job:** the old technician is fenced (`TASK_CLOSED`) and the new one gets a fresh task.
- **stale eligibility:** refused offer, refused acceptance with the offer withdrawn, watermark precedence,
  consumer withdrawal/flagging, and an event racing an acceptance.
- **Workforce outage:** fails closed.
- **media retry:** 503, then the same key converges with one claim.
- **refresh/reconnect:** replay from another replica, 412 on a stale screen, 409 on key misuse.
- **cash handoff:** exact amounts, a late declaration once, never reopens.
- **one in-field task per technician; DB refusals of impossible writes.**

**Not proven here:**

- the real Workforce and Media providers behind Dispatch (C1/C2 are separate PRs; proven in the P03-C merge
  candidate);
- Identity token verification;
- the consumer/relay processes (dependencies are Lane E's);
- Booking's consumption of task milestones (event unpublished);
- Billing's real cash receipt using the work route (needs #111 + Booking `quoteId` composition);
- GPS or location verification (arrival is a manual confirmation by design);
- load beyond the concurrency tests.

## Blockers (external to this child)

See `contract-requests/CR-P03-C4-dispatch-tasks.md`:

- E: publish the task routes and the events, and grant the scopes;
- E: messaging/contracts dependencies for consumer and relay processes;
- E/C1: subject→resource mapping and availability for offers;
- owner: checklist-per-service policy, pending-electronic-payment execution policy (TI-D05), photo count and angle
  policy (TI-D08), and the reassignment request UX (TI-D06).
