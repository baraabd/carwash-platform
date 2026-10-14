# CR-P06-C-01 — technician cash receipt in Billing (to Lane B and Lane E)

Status: **REQUESTED** (blocker B-P06-C-01). Raised by Lane C, P06-C.
Base: `main@66aa7528500a06f65a4b73305506feee7c3fc3b3`.

## Problem

The approved technician flow ends a cash job with «تأكيد استلام الكاش». Today the app records that
as a Dispatch collection declaration (`POST tasks/:id/close {CASH_COLLECTED, amount}` or
`POST tasks/:id/cash-collection`). It is labelled as not a receipt, because only Billing may issue
a cash receipt (`billing.v1 recordCashCollection`, P03-B1, PR #111).

The technician cannot call that route today:

1. `POST /obligations/:obligationId/cash-collections` needs `obligationId` and the obligation
   `expectedRevision`. No technician-readable view exposes either. Booking's technician view hides
   billing internals by design (`booking-view.ts`), and Billing's `GET obligations/:id` is
   owner/staff only.
2. Billing's production `WorkAuthority` is `UnpublishedWorkAuthority`, which always returns 503.
   Dispatch already serves the authority half: `GET /me/bookings/:bookingId/work`, which returns
   `workState`, `technicianSubjectId` and `quoteId` (P03-C4, merged).
3. No gateway route exists for the technician (`billing.cash.collect` permission, CR-B-08).

## Request

| To | Item |
| --- | --- |
| Lane B | Replace `UnpublishedWorkAuthority` with an HTTP adapter to Dispatch `GET /internal/v1/dispatch/me/bookings/:bookingId/work`, forwarding the technician credential, with a timeout. On a timeout or a 5xx, return `WorkAuthorityUnavailable` (503), never allow. |
| Lane B | A technician-scoped read that resolves the booking's obligation without exposing owner data, for example `GET /bookings/:bookingId/cash-collection-target` returning `{obligationId, revision, amountDue: Money}`. It is authorized by the same WorkAuthority (the assigned technician, with work COMPLETED). Alternative: accept `bookingId` alone on `recordCashCollection` and resolve the obligation inside Billing, using the revision fence from Billing's own lock. |
| Lane E | Publish the read and `recordCashCollection` in `billing.v1`. Add operator gateway routes (`/api/operator/bookings/:id/cash-collection-target`, `/api/operator/billing/obligations/:id/cash-collections`). Grant `billing.cash.collect` to the technician role. |

## Lane C consumption plan (after E publishes)

The app keeps the Dispatch declaration, which records the task outcome. It then records the Billing
receipt with its own idempotency key, derived from the same intent. A missing receipt shows the
existing pending state; it is never shown as paid. The visual flow is unchanged, so no new screen
is needed. Collections continue to read Dispatch declarations until a Billing receipt projection
is published.
