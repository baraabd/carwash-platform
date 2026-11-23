# P01-D2: Communications notification intent and delivery state

Parent task: P01-D. Status of the parent: **INTEGRATION_PENDING**.
Nothing here is a working SMS/push/email channel: no provider account,
credentials or documented provider idempotency exist yet (external blocker).
Contract requests to Lane E are in `P01_CONTRACT_REQUESTS_TO_E.md` (merged
with P01-D1).

## What exists now

| Layer | Content |
| --- | --- |
| Domain `src/domain/notification.ts` | Closed channels and states, request validation (opaque recipient reference, bounded parameters, a 7-day maximum TTL), request fingerprint, bounded full-jitter backoff, submission/receipt/lease-expiry transition rules |
| Ports `src/ports/notification.ports.ts` | `NotificationProvider`, `NotificationIntake`, `NotificationRepository`, clock, id, hasher |
| Application `src/application/notification.service.ts` | `EnqueueNotification`, `DeliveryWorker` (fenced, deadline-bound), `NotificationAdministration` (receipt, cancel, find) |
| Infrastructure | `PrismaNotificationIntake`/`PrismaNotificationRepository`, plus `HttpNotificationProvider` (HTTPS only; plain HTTP only on loopback) |
| Process `src/delivery/delivery.runner.ts` | A standalone worker. It **refuses to start** without `NOTIFICATION_PROVIDER_URL`, `NOTIFICATION_PROVIDER_TOKEN` and an explicit `NOTIFICATION_PROVIDER_IDEMPOTENT=true|false` |
| Migration | `20261007100000_p01d_notification_delivery_state`, additive only |

## Delivery truth model

`QUEUED → SENDING → PROVIDER_ACCEPTED → DELIVERED`, with `RETRY_WAIT`,
`UNKNOWN`, `FAILED`, `EXPIRED` and `CANCELLED`. Persisting an intent sends
nothing, so a source owner's transaction never waits on a provider.

| Provider observation | Classified as | Resulting state |
| --- | --- | --- |
| 2xx with a correlatable `messageId` | `ACCEPTED` | `PROVIDER_ACCEPTED` (not "delivered") |
| 2xx without a usable id | `AMBIGUOUS` | see below |
| 401/403/408/429 | `REJECTED`, retryable | `RETRY_WAIT` / `FAILED` once attempts are exhausted / `EXPIRED` |
| Other 4xx | `REJECTED`, permanent | `FAILED` |
| Connection refused or DNS failure | `NOT_SUBMITTED` | `RETRY_WAIT` |
| Timeout, reset, 5xx, adapter exception | `AMBIGUOUS` | `UNKNOWN`, or `RETRY_WAIT` only when the provider is declared idempotent on our key |

A timeout is never success and never a blind resend. Every attempt of one
intent carries the same provider idempotency key, `cw-notification:<id>`.

**Fencing.** Each claim is a compare-and-set on `(fence, state)` that increments
`fence`. A completion writes only if the fence is unchanged and the state is
`SENDING`, or `UNKNOWN` because this claim's own lease lapsed with no newer
claim. A newer claim or a provider receipt always wins. The attempt row
always records what its own claim observed, so a late `ACCEPTED` is kept as
evidence.

The worker claims one intent immediately before submission. Its batch size is a
per-pass limit, so interruption on one provider call leaves later intents queued
without attempts or leases. Completion and lease recovery both acquire the
notification row before the attempt row to avoid a PostgreSQL deadlock.

**Database invariants.** CHECK constraints enforce the known states and channels,
"lease present exactly while SENDING", "provider id only when
accepted/delivered/failed", and an attempt outcome only when finished.
`(source_service, idempotency_key)` is unique.

## Inbox idempotency

`PrismaNotificationIntake` joins the caller's transaction. A consumer effect
therefore records the intent atomically with its inbox row (case C3). No
business event currently has an accepted contract, topology and ACL toward
Communications (CR-D-P01-04), so no broker consumer creates intents yet. This
child proves the transactional seam, not a live business flow.

## Evidence

| Family | Command | Result on this branch |
| --- | --- | --- |
| Domain plus a real-socket HTTP provider | `node --test services/communications/dist-tests/test/*.spec.js` | see PR |
| Real PostgreSQL | `node scripts/production/D/run-real-infra.mjs --suite communications` | see PR |
| Hosted regression gate | `.github/workflows/p01-communications-acceptance.yml` | see the current head's workflow result |
| Guards | layers, boundaries, append-only migrations, design reference, prettier, eslint | see PR |

Real versus scripted: PostgreSQL and the HTTP sockets are real. Cases C4–C11 use a
scripted `NotificationProvider` port implementation, declared in each test, to
force exact provider answers. C13 uses the real HTTP adapter against a real
local server that never answers.
C14 also uses a scripted provider while checking persisted unclaimed work.
C15 coordinates real PostgreSQL transactions to exercise completion racing
both lease-expiry paths; it preserves late provider evidence and checks fencing.
The separate worker unit suite exercises pending submission, completion failure,
per-pass limits and fresh claim clocks without claiming database evidence.

## Pending

- A real provider (account, credentials, documented idempotency and verified
  delivery receipts): an **external blocker**. Receipt signature verification
  belongs in that provider's adapter.
- Reconciliation of `UNKNOWN` through a provider status API needs that
  provider's documented lookup.
- The read API and the gateway route wait for `communications.read` (CR-D-P01-01/05).
- Membership, conversations and messages (W04 plan §5) are not in this child.
