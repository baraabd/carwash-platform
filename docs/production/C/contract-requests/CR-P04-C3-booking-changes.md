# CR-P04-C3: `booking.v1` change routes and change events

**To:** Lane E. **From:** Lane C, P04-C3 (provider implemented).
**Kind:** additive to the requested `booking.v1` (CR-P02-C2). Existing routes are unchanged; the booking view gains three fields.

## 1. Routes (prefix `/internal/v1/booking`)

| Name | Method and path | Access | Body | Success |
| --- | --- | --- | --- | --- |
| `cancelBooking` | `POST /bookings/:bookingId/cancellation` | principal `bookings.create:self` (own booking), or `operations.dispatch` | `{expectedRevision:int, reason}` | 202 `BookingChangeV1`; 200 on replay |
| `rescheduleBooking` | `POST /bookings/:bookingId/reschedule` | principal `bookings.create:self` (own booking) | `{expectedRevision:int, holdId:uuid, holdRevision:int}` | 202 `BookingChangeV1`; 200 on replay |
| `listBookingChanges` | `GET /bookings/:bookingId/changes` | owner (`bookings.read:self`) or `operations.dispatch` | | 200 `{items: BookingChangeV1[]}`, newest first, at most 50 |

- Both POST routes require an `Idempotency-Key`. Replay is keyed on (requester, key) and is answered before any validation.
- Allowed `reason` values:
  - customer: `CUSTOMER_REQUEST`;
  - staff: `OPERATIONS_REQUEST`, `CUSTOMER_REQUEST_BY_PHONE`, `SERVICE_UNAVAILABLE`.

## 2. Types

`BookingChangeV1`:

| Field | Type |
| --- | --- |
| `changeId` | uuid |
| `bookingId` | uuid |
| `kind` | `CANCELLATION` \| `RESCHEDULE` |
| `state` | `IN_PROGRESS` \| `COMPLETED` \| `REFUSED` \| `FAILED` |
| `reason` | string \| null |
| `refusal` | `WORK_STARTED` \| `WORK_COMPLETED` \| `BOOKING_CANCELLED` \| `HOLD_EXPIRED` \| `HOLD_NOT_ACTIVE` \| `HOLD_UNAVAILABLE` \| `DISPATCH_NOT_READY` \| null |
| `attention` | boolean |
| `requestedAt` | UTC timestamp |
| `completedAt` | UTC timestamp \| null |
| `from` | `{holdId, zoneId, startsAt, endsAt}` |
| `to` | the same shape, or null |
| `settlement` | `PENDING` \| `VOIDED` \| `REFUND_PENDING` \| `NOTHING_DUE` \| null |

**`BookingV1` additions:**

- `schedule`: `{revision, holdId, zoneId, startsAt, endsAt}`, or null before confirmation;
- `cancellation`: `{reason, cancelledAt}` or null;
- `pendingChange`: a `BookingChangeV1` or null.

`slot` keeps its meaning: the original committed slot, which never changes.

## 3. Errors

| Error | Reason |
| --- | --- |
| 409 `CONFLICT` | `BOOKING_NOT_CONFIRMED`, `BOOKING_CANCELLED`, `CHANGE_IN_PROGRESS` |
| 412 `REVISION_CONFLICT` | |
| 422 `BUSINESS_RULE_VIOLATION` | `HOLD_NOT_FOUND`, `HOLD_NOT_ACTIVE`, `ZONE_MISMATCH`, `DURATION_MISMATCH`, `SAME_SLOT` |

## 4. Events (envelope v2, exchange `booking.events`, producer-pending)

`booking.cancelled.v1`:

- `aggregate {type:'booking', id, version}`;
- `actor`: the requester's subject id;
- `data {status:'CANCELLED', changeId, reason, holdId, zoneId, startsAt, endsAt, paymentMethod, total:MoneyWire}`.

`booking.rescheduled.v1`:

- `data {changeId, scheduleRevision, previous:{holdId,startsAt,endsAt}, current:{holdId,zoneId,startsAt,endsAt}}`.

Both are emitted exactly once per change, in the transaction of the pivot. They carry no contact, address, vehicle or plate data. Please add both to the business event registry and AsyncAPI, with parsers.

## 5. Gateway (customer and admin surfaces)

| Gateway route | Booking route | Who |
| --- | --- | --- |
| `POST /api/customer/bookings/:id/cancellation` | `POST /internal/v1/booking/bookings/:id/cancellation` | customer, on their own principal |
| `POST /api/customer/bookings/:id/reschedule` | `POST /internal/v1/booking/bookings/:id/reschedule` | customer, on their own principal |
| `GET /api/customer/bookings/:id/changes` | `GET /internal/v1/booking/bookings/:id/changes` | customer, on their own principal |
| admin: cancellation and changes | the same Booking routes | staff |

**Consumers:**

- Lane A: the customer screens. The approved design has no cancel or reschedule screen; it is pending owner design.
- Lane D: live-operations projections, via the events.

## 6. Configuration

| Workload | Additional configuration |
| --- | --- |
| Booking | `BOOKING_DISPATCH_*` must carry a token whose Dispatch client holds `dispatch.booking.change` |
| Booking | `BOOKING_TOKEN_SCHEDULING` must belong to a Scheduling client holding `scheduling.commitment.change` |
| Billing | the Billing client must hold `billing.booking.cancel` |

See CR-P04-C1, CR-P04-C2 and CR-P04-C3-billing.
