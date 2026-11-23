# CR-P03-C3 — Booking technician view (request to Lane E)

Requester: Lane C (P03-C / C3). Implementation: `services/booking`.
Lane C does not edit shared packages, lockfiles, CI, infra, architecture or the
gateway. Every item below is a request for review, versioning and publication.
Until then the route is **provider-implemented, contract-requested**, and
nothing in Booking claims it as published.

## 1. Add to `booking.v1`: `getTechnicianView`

`GET /internal/v1/booking/bookings/:bookingId/technician-view`

Caller: a user whose Identity session has `work.read:assigned`. Service
credentials are refused.

Response 200 (`TechnicianBookingViewV1`). The shape is exactly that of
`P03-C-interfaces.md` C3:

```
{ bookingId: uuid, revision: int>=1,
  status: 'CONFIRMED'|'ASSIGNED'|'EN_ROUTE'|'ARRIVED'|'IN_PROGRESS'|'COMPLETED',
  slot: { zoneId: uuid, startsAt: utc, endsAt: utc },
  vehicle: { type: 'sedan'|'suv'|'large'|'pickup', make: string|null, model: string|null,
             color: string|null, plate: { text: string, region: string|null } | null },
  address: { location: { mode: 'manual', description: string }
                      | { mode: 'coordinates', point: { latitude: string, longitude: string },
                          description: string|null },
             details: string|null },
  contact: { name: string, phone: E.164 string, notes: string|null },
  lines: [{ lineId: uuid, kind: 'PACKAGE'|'EXTRA'|'VEHICLE_SURCHARGE'|'DISCOUNT'|'FEE'|'TAX',
            definitionId: uuid|null, quantity: int, amount: Money }],
  total: Money,
  paymentMethod: 'CASH_ON_COMPLETION'|'SHAM_CASH'|'SYRIATEL_CASH' }
```

`Money` is the published wire form `{currency, amountMinor: "<integer string>", scale}`.
The object is closed. It contains no customer subject, quote id or revision,
catalog or price-book revision, unit price, hold id or owner record ids.

Errors use the platform envelope:

| Status | Code / reason | Meaning |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | No credential, or the credential is not valid. |
| 403 | `AUTH_FORBIDDEN` | The caller lacks `work.read:assigned`. |
| 404 | `NOT_FOUND` / `BOOKING_NOT_FOUND` | Not the current ASSIGNED technician, or the booking is not visible. The body is the same in every case. |
| 429 | `RATE_LIMITED` | The per-principal budget is used up. |
| 503 | `DEPENDENCY_UNAVAILABLE` / `ASSIGNMENT_UNVERIFIED` | Dispatch could not confirm the assignment. Retryable. |

The closed cross-service code list has no `ASSIGNMENT_UNVERIFIED` code. The
spec's "503 `ASSIGNMENT_UNVERIFIED`" is therefore delivered as the `reason` of
the `DEPENDENCY_UNAVAILABLE` code. Lane E decides whether this stays a reason
or becomes a code.

Every 200 writes an audit row `booking.technician-view.read` with opaque ids
only.

## 2. Workload identity: Booking → Dispatch `dispatch.assignment.read`

Booking calls Dispatch `GET /internal/v1/dispatch/bookings/:id/assignment` on
every technician read. This call is the authorization.

Interim mechanism: the configuration below is validated at Booking's startup.

| Side | Setting |
| --- | --- |
| Booking | `BOOKING_DISPATCH_URL`, `BOOKING_DISPATCH_CLIENT_ID` (default `booking`), `BOOKING_DISPATCH_CLIENT_TOKEN` (32–256 characters), `BOOKING_DISPATCH_TIMEOUT_MS` (100–10000, default 1000) |
| Dispatch | `DISPATCH_SERVICE_CLIENTS` entry `{"id":"booking","tokenSha256":"<sha256>","scopes":["dispatch.assignment.read"]}` |

Request: grant Booking's workload identity the scope `dispatch.assignment.read`
on Dispatch through the platform mechanism (CR-P02-C3 §4), with per-environment
secret provisioning and rotation. The token is a different secret from
`BOOKING_TOKEN_<OWNER>`. Dispatch's `dispatch.v1` (CR-P02-C3 §3) should also
publish the fields Booking reads: `bookingId`, `status`,
`technicianSubjectId` and `revision`. These fields must stay stable.

## 3. Gateway route `/api/operator/bookings/:id`

Requested in P03-C C5:

| Browser path | Upstream |
| --- | --- |
| `GET /api/operator/bookings/:id` | booking `GET /internal/v1/booking/bookings/:id/technician-view` |

The gateway route must:

- forward `Authorization` and `x-correlation-id`;
- strip any `x-service-*` header coming from the browser;
- pass the 404, 503 and 429 envelopes through unchanged;
- not cache the response (`Cache-Control: no-store`), because the response
  carries contact data.

## 4. Later: Booking consumes `dispatch.task-progressed.v1`

When C4 publishes `dispatch.task-progressed.v1`
(`{bookingId, assignmentId, taskId, stage}`), Booking will consume it through
its inbox and move the booking lifecycle in these steps:

`CONFIRMED → ASSIGNED` (ACCEPTED) → `EN_ROUTE` → `ARRIVED` → `IN_PROGRESS`
(IN_SERVICE/DOCUMENTING) → `COMPLETED` (FINISHED or CLOSED, owner to decide)

Rules for the consumer:

- updates are version-guarded;
- an older stage never moves the booking back;
- WITHDRAWN, RELEASED and CANCELLED do not regress the booking;
- the booking returns to CONFIRMED only through an explicit, audited rule.

**This is not implemented in this child, because the event is unpublished.**
Until it is, a technician's view shows `CONFIRMED` throughout the job. The
technician view already admits every one of these statuses.

## 5. Unchanged

- No schema change.
- No new dependency.
- No change to Dispatch.
- No change to the frozen interface file.
