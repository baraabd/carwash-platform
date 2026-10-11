# CR-P04-C2: Dispatch booking-change commands (requested `dispatch.v1` additions)

**To:** Lane E. **From:** Lane C, P04-C2 (provider implemented).
**Kind:** additive. The existing dispatch routes, views and events are unchanged, apart from the new enum values in §3.

## 1. Routes (prefix `/internal/v1/dispatch`)

All four routes use service scope `dispatch.booking.change`, granted to the `booking` workload, and are idempotent.

| Name | Method and path | Body |
| --- | --- | --- |
| `cancelBookingJob` | `POST /bookings/:bookingId/cancellation` | `{changeId}` |
| `rebindBookingJob` | `POST /bookings/:bookingId/rebinding` | `{changeId, holdId, zoneId, startsAt, endsAt}`, where `startsAt`/`endsAt` are UTC instants with `Z` |
| `confirmBookingJobRebind` | `POST /bookings/:bookingId/rebinding/confirm` | `{changeId}` |
| `revertBookingJobRebind` | `POST /bookings/:bookingId/rebinding/revert` | `{changeId}` |

All bodies are closed and all ids are UUIDs.

Response `BookingJobChangeV1`:

- `bookingId`, `changeId`;
- `outcome`: `CANCELLED` | `NOT_OPENED` | `REBOUND` | `CONFIRMED` | `REVERTED` | `NOTHING_TO_REVERT`;
- `assignmentRevision`: int or null.

## 2. Reasons

| Reason | Error |
| --- | --- |
| `WORK_STARTED`, `WORK_COMPLETED`, `BOOKING_CANCELLED` | 422 `BUSINESS_RULE_VIOLATION` |
| `ASSIGNMENT_NOT_OPEN`, `RESCHEDULE_PENDING`, `CHANGE_MISMATCH`, `CHANGE_REVERTED`, `CHANGE_CONFIRMED` | 409 `CONFLICT` |
| `CHANGE_NOT_FOUND` | 404 |

## 3. Enum widening on existing producer-pending shapes

| Shape | New value |
| --- | --- |
| `dispatch.assignment-changed.v1` and the assignment view `cancelReason` | `BOOKING_CANCELLED` |
| Offer `withdrawReason`, task `endReason` | `JOB_RESCHEDULED` |

## 4. Workload identity

Interim configuration until workload identity is published:

```
DISPATCH_SERVICE_CLIENTS=[{"id":"booking","tokenSha256":"…","scopes":["dispatch.assignment.read","dispatch.booking.change"]}]
```

## 5. Gateway

None. These routes are service-to-service only.
