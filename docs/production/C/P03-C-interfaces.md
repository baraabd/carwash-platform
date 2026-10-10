# P03-C — Cross-child interfaces (Dispatch and technician job execution)

Status: **REQUESTED / producer-pending** unless a row says *published*. This file
is byte-identical in every P03-C child PR so the children merge cleanly. It is
the single statement of what each child provides and consumes. Nothing here is
a Lane E publication; each owner's contract request (CR) asks E to publish it.

Base: `main@a14997a20b85341a24f17e7878d2a188eea3fe36`.

## Ownership (unchanged boundaries)

| Fact | Owner | Never stored by |
| --- | --- | --- |
| Technician profile, eligibility, shifts, **availability (ready/break)** | Workforce | Dispatch, operator-web |
| Assignment, offers, **task execution record** (stages, checklist, evidence links, handoff declaration) | Dispatch | Booking, Media |
| Booking lifecycle, immutable vehicle/address/contact/quote snapshots | Booking | Dispatch |
| Evidence bytes and object metadata | Media | Dispatch (stores opaque object ids only) |
| Money: obligations, payment verification, cash receipts and custody | Billing | Dispatch records only the technician's *declaration* |

Decision P03-C-D1: the execution record of an accepted job lives in Dispatch,
inside the same aggregate as the assignment, so that every technician step is
fenced by the *current* assignment in one local ACID transaction (a reassigned
or ineligible technician can never advance a job). Booking learns milestones
only through `dispatch.task-progressed.v1` (producer-pending), never by
reading Dispatch tables.

## Published contracts consumed

- `workforce.v1` `listCapacityResources` (`GET /internal/v1/workforce/capacity-resources?zoneId&from&to&limit&cursor`,
  `service:workforce.capacity.read`), `CapacityResourceV1`, `Page<T>` — *published* in `@carwash/contracts@0.1.0`.
  `resourceId` = Workforce operator id.
- `workforce.eligibility-changed.v1` (envelope v2, aggregate `capacity-resource`,
  id = resourceId, version = eligibilityRevision, data `{eligibility}`) — *published*.
- `scheduling.hold-changed.v1` — *published* (already consumed by Dispatch).

## C1 — Workforce (provider)

1. Implement published `listCapacityResources` exactly (resource = operator; `revision` = operator
   version; `eligibility` = ELIGIBLE iff operational readiness holds at the query's `from`;
   `eligibilityRevision` increases on every change of the inputs of eligibility (employment,
   suspension, verification, skills); `zoneIds` = distinct zones of ACTIVE shifts overlapping
   `[from,to)` (resource omitted when none); `shifts` = those shifts, sorted, non-overlapping, ≤100).
   Filter: a shift in `zoneId` overlapping `[from,to)`.
2. Emit `workforce.eligibility-changed.v1` in the **published** shape (outbox, same transaction).
3. Technician availability, owned by Workforce, *requested*:
   - `GET  /internal/v1/workforce/me/availability` → `{ status: 'AVAILABLE'|'ON_BREAK', revision, updatedAt }`
     (default `ON_BREAK` revision 0 when never set). Caller: user with `work.read:assigned`
     whose subject has an operator profile; otherwise 404 `OPERATOR_NOT_FOUND`.
   - `PUT  /internal/v1/workforce/me/availability` body `{ status, expectedRevision }` →
     same view; 409 `REVISION_CONFLICT` on stale revision; requires `work.execute:assigned`.
     Audited. Availability never changes eligibility or capacity.

## C2 — Media (provider, *requested* `media.v1`, prefix `/internal/v1/media`)

Object states: `RESERVED → AVAILABLE | REJECTED`, `RESERVED → EXPIRED`, `AVAILABLE → PURGED`.
Bytes live in a private S3 bucket under key `objects/<objectId>`; no PII in keys, URLs or logs.

| Method | Path | Caller | Notes |
| --- | --- | --- | --- |
| POST | `/uploads` | user `work.execute:assigned`, `Idempotency-Key` | body `{purpose:'WORK_EVIDENCE', contentType:'image/jpeg'|'image/png'|'image/webp', byteLength:int 20..10485760, sha256:<64 hex>}` → 201 `ObjectView & {upload}` |
| POST | `/objects/:id/upload-url` | owner, while RESERVED | fresh presigned PUT (retry after a failed/expired upload) |
| POST | `/objects/:id/finalize` | owner, `Idempotency-Key` | server reads the stored bytes, verifies length + SHA-256 + magic bytes → AVAILABLE or REJECTED(reason); 409 `UPLOAD_MISSING` (retryable) when no object yet |
| GET | `/objects/:id` | owner, or service scope `media.object.read` | `ObjectView` |
| POST | `/objects/:id/read-url` | owner, or service scope `media.object.read` | presigned GET, TTL 60–300 s, only when AVAILABLE |
| POST | `/objects/:id/claims` | service scope `media.object.claim` | body `{claimRef:uuid, holder:'dispatch.task-evidence'}`; idempotent per (object, claimRef); only AVAILABLE; a claimed object is never purged |

`ObjectView = { objectId, revision, status, purpose, contentType, byteLength, sha256, ownerSubjectId, rejectReason|null, claimed:boolean, createdAt, finalizedAt|null, expiresAt|null }`.
`upload = { method:'PUT', url, headers:{'content-type', 'x-amz-checksum-sha256'?...}, expiresAt }` (exact signed headers listed).
Errors: `OBJECT_NOT_FOUND` (also for another owner's object), `OBJECT_NOT_AVAILABLE`, `UPLOAD_MISSING`,
`UPLOAD_MISMATCH`, `UNSUPPORTED_MEDIA`, `IDEMPOTENCY_CONFLICT`, `REVISION_CONFLICT`, `STORAGE_UNAVAILABLE` (503, never success).
Unclaimed AVAILABLE objects older than retention and EXPIRED reservations are purged by a worker.
No malware scanner exists: `scan` is reported as `NOT_SCANNED` (external blocker), content sniffing only.

## C3 — Booking (provider, *requested* addition to `booking.v1`)

`GET /internal/v1/booking/bookings/:bookingId/technician-view` — user with `work.read:assigned`.
Booking authorizes by calling Dispatch `GET /internal/v1/dispatch/bookings/:bookingId/assignment`
with service scope `dispatch.assignment.read`: allowed only when `status = ASSIGNED` and
`technicianSubjectId` = caller subject; otherwise 404 `BOOKING_NOT_FOUND` (no probing).
Dispatch unavailable → 503 `ASSIGNMENT_UNVERIFIED` (fail closed, never cached as allow).
Response (purpose-limited, no customer subject id, no quote/price-book internals):

```
{ bookingId, revision, status, slot:{zoneId,startsAt,endsAt},
  vehicle:{type,make|null,model|null,color|null,plate:{text,region|null}|null},
  address:{location:{mode:'manual',description}|{mode:'coordinates',point:{latitude,longitude},description|null}, details|null},
  contact:{name, phone, notes|null},
  lines:[{lineId, kind, definitionId|null, quantity, amount:Money}],
  total: Money, paymentMethod:'CASH_ON_COMPLETION'|'SHAM_CASH'|'SYRIATEL_CASH' }
```
Audited read (`booking.technician-view.read`, opaque ids only).

## C4 — Dispatch (provider of `dispatch.v1` task routes; consumer of C1/C2 and published workforce.v1)

Offer/accept eligibility: before an offer and again before acceptance Dispatch reads published
`listCapacityResources` for the job's zone and window; the resource must be ELIGIBLE with one
shift covering `[startsAt,endsAt)`. Refusal `RESOURCE_INELIGIBLE` (422); Workforce timeout/5xx →
503 `ELIGIBILITY_UNAVAILABLE` with no state change. Dispatch consumes published
`workforce.eligibility-changed.v1`: INELIGIBLE withdraws live offers and unstarted (ACCEPTED) tasks
of that resource; started tasks are flagged for operations, never silently cancelled.

Task stages (reference stage in brackets):
`ACCEPTED [accepted] → EN_ROUTE [route] → ARRIVED [before] → IN_SERVICE [wash] → DOCUMENTING [after] → FINISHED [handoff] → CLOSED [closed]`,
terminal side exits `RELEASED` (technician returned it before departure), `WITHDRAWN` (operations
reassigned/unassigned, or eligibility lost), `CANCELLED` (slot released).
An OFFERED offer is reference stage `assigned`.

Technician routes (user `work.read:assigned` for GET, `work.execute:assigned` + `Idempotency-Key`
+ body `expectedRevision` for POST/PUT/DELETE). Another technician's task → 404 `TASK_NOT_FOUND`.

| Method | Path | Body | Rule |
| --- | --- | --- | --- |
| GET | `/me/jobs` | — | offers OFFERED + tasks (active, and closed/released in last 7 days) |
| GET | `/me/tasks/:taskId` | — | detail incl. checklist, evidence slots, notes, history |
| POST | `/offers/:id/accept` | `{}` | creates the task (existing route) |
| POST | `/offers/:id/decline` | `{reason, note?}` | existing route; `note` 3–500 chars optional |
| POST | `/tasks/:id/depart` | `{expectedRevision}` | ACCEPTED→EN_ROUTE; refused `TECHNICIAN_BUSY` if another task of the technician is in EN_ROUTE..FINISHED (DB partial unique) |
| POST | `/tasks/:id/arrive` | `{expectedRevision}` | EN_ROUTE→ARRIVED, `arrivalMethod:'MANUAL_CONFIRMATION'` (no GPS claim) |
| PUT | `/tasks/:id/evidence/:phase/:slot` | `{expectedRevision, mediaObjectId}` | phase BEFORE only in ARRIVED, AFTER only in DOCUMENTING; slot 0/1; Media object must be AVAILABLE, owned by caller, purpose WORK_EVIDENCE; claimed in Media; replaces the slot (old link kept in history) |
| DELETE | `/tasks/:id/evidence/:phase/:slot` | `{expectedRevision}` | same stage rule |
| PUT | `/tasks/:id/condition-note` | `{expectedRevision, text}` | ≤800 chars, ARRIVED or IN_SERVICE; empty text clears |
| POST | `/tasks/:id/start` | `{expectedRevision}` | ARRIVED→IN_SERVICE; ≥1 BEFORE evidence |
| PUT | `/tasks/:id/checklist/:code` | `{expectedRevision, checked}` | IN_SERVICE only; codes from the task's checklist snapshot |
| POST | `/tasks/:id/document` | `{expectedRevision}` | IN_SERVICE→DOCUMENTING; every required check done |
| POST | `/tasks/:id/finish` | `{expectedRevision}` | DOCUMENTING→FINISHED; ≥1 AFTER evidence; explicit confirmation is the UI's job |
| POST | `/tasks/:id/close` | `{expectedRevision, collection}` | FINISHED→CLOSED; `collection` = `{outcome:'CASH_COLLECTED', amount:Money}` \| `{outcome:'CASH_NOT_COLLECTED', reason}` \| `{outcome:'NOT_CASH'}` |
| POST | `/tasks/:id/cash-collection` | `{expectedRevision, amount}` | CLOSED with `CASH_NOT_COLLECTED` only; late declaration, never reopens work |
| POST | `/tasks/:id/release` | `{expectedRevision, reason}` | ACCEPTED only; withdraws the accepted offer (`RELEASED_BY_TECHNICIAN`), assignment → UNASSIGNED |
| POST | `/tasks/:id/notes` | `{kind:'HELP'\|'CASH_ISSUE'\|'PAYMENT_FOLLOW_UP', text}` | 3–500 chars; not when terminal (except PAYMENT_FOLLOW_UP/CASH_ISSUE after CLOSED) |

Checklist snapshot `washgo.checklist.v1` (owner policy pending, from the approved reference):
`exterior` (الهيكل والزجاج), `wheels` (الجنوط والإطارات), `interior` (المقصورة), `quality` (الفحص النهائي), all required.

Task view: `{ taskId, revision, stage, assignmentId, bookingId, zoneId, startsAt, endsAt,
acceptedAt, departedAt|null, arrivedAt|null, arrivalMethod|null, startedAt|null, documentedAt|null,
finishedAt|null, closedAt|null, conditionNote|null, checklist:{version, items:[{code, required, checked}]},
evidence:{BEFORE:[slot0|null, slot1|null], AFTER:[...]} (each `{mediaObjectId, attachedAt}`),
collection:{outcome, amount|null, reason|null, declaredAt, lateAmount|null, lateDeclaredAt|null}|null,
notes:[{noteId, kind, text, createdAt}], history:[{at, action}], releaseReason|null }`.

Events (outbox, producer-pending): `dispatch.task-progressed.v1` data
`{bookingId, assignmentId, taskId, stage}`; `dispatch.cash-declared.v1` data
`{bookingId, taskId, outcome, amount:Money|null, late:boolean}` (for Billing; a declaration is not a receipt).

## C5 — operator-web (consumer)

Vanilla TypeScript port of `design/reference/approved/washgo-technician-interactive.html`
(no new dependencies). Talks only to same-origin paths that the gateway is *requested* to expose:

| Browser path | Upstream |
| --- | --- |
| `GET /api/operator/session` | identity `/session` |
| `GET/PUT /api/operator/availability` | workforce `/me/availability` |
| `GET /api/operator/jobs`, `GET /api/operator/tasks/:id` | dispatch `/me/jobs`, `/me/tasks/:id` |
| `POST /api/operator/offers/:id/(accept\|decline)` | dispatch |
| `POST/PUT/DELETE /api/operator/tasks/:id/...` | dispatch task routes |
| `GET /api/operator/bookings/:id` | booking `/bookings/:id/technician-view` |
| `POST /api/operator/media/uploads`, `/api/operator/media/objects/:id/(upload-url\|finalize\|read-url)` | media |
