# CR-P08-C1 — Fence a superseded technician's read access to job evidence (media.v1)

Requested by: Lane C (P08-C1). Owner of the change: **Lane E** (published `media.v1` and
service scopes), then Lane C implements both sides.
Status: **REQUESTED**. Nothing in this PR consumes or implements it.

## Problem (finding OPS-F01)

The P08-C acceptance run (`tests/production/C/ops-acceptance.test.mjs`, OPS-04) reassigns a job
while technician A is on site, after A has attached a BEFORE photo.

- Dispatch fences A completely. Every task command returns `409 TASK_CLOSED` or `404`, and
  Booking's technician view returns `404`.
- Media still answers `POST /objects/:id/read-url` for A with `200`. The reason: Media authorizes a
  user read by `ownerSubject` alone (`services/media/src/application/media.service.ts`,
  `readable()` → `ownRecord()`).

The effect: a technician removed from a job can keep re-issuing short-lived URLs to the customer's
vehicle photos for as long as the object exists. A claimed object is never purged. Each URL is
bounded by `readUrlTtlMs` (60–300 s), but the URLs can be re-issued indefinitely.

Media cannot fix this on its own. It does not know who currently holds the job; Dispatch does. The
claim holder (Dispatch, scope `media.object.claim`) is the only party that can say "the uploader no
longer has a reason to read this".

## Requested contract (additive, `media.v1` minor)

1. New service scope `media.object.fence`, granted to Dispatch only.
2. `POST /internal/v1/media/objects/{objectId}/claims/{claimRef}/owner-access`:
   - body `{ "access": "REVOKED", "reason": "TASK_ENDED" }`;
   - `Idempotency-Key` required;
   - `200` with the object view; `404` for an unknown object or claim.

   After this call, a USER read of the object by its `ownerSubject` returns `404` (no probing).
   Service reads (`media.object.read`) are unchanged. The call is idempotent and never re-grants
   access.
3. The object view gains `ownerAccess: "GRANTED" | "REVOKED"`, read-only.

## Provider/consumer obligations once published

- **Media (Lane C).** Store the fence on the claim row in the same transaction as an audit fact
  `media.owner-access.revoked`. A migration adds a nullable column (expand only).
- **Dispatch (Lane C).** When a task ends without closing (`WITHDRAWN`, `CANCELLED`, `RELEASED`),
  the same transaction writes an outbox row `dispatch.evidence-fence.requested`. A worker calls the
  route with a bounded retry and jitter. A non-2xx response is kept for retry; it is never treated
  as success. After the dead-letter limit, the task is flagged `attentionReason=EVIDENCE_FENCE_PENDING`.
- **Operator-web.** No visible change. A fenced technician no longer has the job, so no photo is
  shown.

## Owner decision needed

TI-D08 (photo policy) is still open. The owner decides whether a technician keeps read access to
their **own** evidence of a job they **closed**, for example during the recent-tasks window. This
request fences only superseded work (reassigned, cancelled or released), which is a security
requirement and does not depend on TI-D08.

## Implementation in P06-CLOSE-07 (owner decision D07-1, 2026-10-14)

The owner decided to fix B-07-01 in P06-CLOSE-07. Lane C implemented both sides of this request
on `prod/p06-close-07-technician-media`. The text above is the request as it was made.
media.v1 itself is still unpublished: it stays in `unpublishedBusinessDomains`, and publishing it
remains Lane E's job.

Implemented as requested:

- the route, its body and the `Idempotency-Key`;
- the `media.object.fence` scope, granted to Dispatch only;
- the 404 for an unknown object or claim;
- the 404 for every owner request after the fence;
- `ownerAccess` in the object view;
- the audit fact `media.owner-access.revoked`.

Differences, with the reasons:

| Request | Implemented | Why |
| --- | --- | --- |
| A nullable column on the claim row | A new append-only table `object_owner_fence` (FK to the claim) | `object_claim` is append-only by trigger. A new table is expand-only and leaves that guard untouched. |
| A Dispatch outbox row `dispatch.evidence-fence.requested` | A dedicated table `evidence_fence`, delivered by `workers/evidence-fence.main.ts` | The shared relay publishes every `outbox_message` row to RabbitMQ. A fence request is a call to Media, not a broker event. |
| A dead-letter limit, then `attentionReason=EVIDENCE_FENCE_PENDING` | No dead letter: capped exponential backoff (≤ 5 min) forever, and a `stuck` count in the worker's pass line | The task row is terminal, and its guard (`TASK_TERMINAL`) refuses any update. Giving up on a fence would leave the access open. |

Residual windows (declared, not hidden):

- Between the end of the task and the worker's successful pass, the old grant is still in force.
  The window is bounded by the worker interval and Media's availability.
- Dispatch claims at Media before its own transaction. If that transaction then fails (for example,
  the task ended concurrently), the object is claimed but not linked, so no fence is queued. The
  uploader can still read that unlinked photo of their own.
