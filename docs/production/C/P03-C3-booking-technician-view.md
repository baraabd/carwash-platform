# P03-C3 — Booking technician view

Child of P03-C (Dispatch and the technician's job execution). Base: `main` at
`a14997a20b85341a24f17e7878d2a188eea3fe36`. Not stacked on any other child.
Binding interface: `P03-C-interfaces.md` section "C3 — Booking" (committed here
unchanged, byte-identical to the other P03-C children). Contract requests:
`contract-requests/CR-P03-C3-booking-technician-view.md`.

## Responsibility boundary

Booking owns the booking and its immutable snapshots (contact, vehicle,
address, quote lines, slot). Dispatch owns who does the job (P03-C decision
D1). This child adds one read to Booking:

`GET /internal/v1/booking/bookings/:bookingId/technician-view`

It lets the technician who currently holds the job read what they need to do
it. Booking still stores no technician, offer or assignment. It does not read
Dispatch tables and keeps no copy of Dispatch's answer.

```
transport/http   BookingController.technicianView -> technicianBookingView (wire mapping)
application      TechnicianViewQuery (permission, decideAssignment, decideBooking, audit)
ports            AssignmentVerifier.currentAssignee -> {status, technicianSubjectId, revision} | NOT_FOUND
                 AssignmentUnavailable; BookingStore.recordAudit
infrastructure   DispatchAssignmentClient (HTTP to Dispatch), dispatchAssignmentConfig (startup validation)
```

`node scripts/check-layers.mjs` passes. Domain, application and ports import
no Nest, Prisma, pg or fetch.

## Why Booking asks Dispatch synchronously

- **This is a read.** No distributed write, saga or compensation is involved.
  The worst case of a failed check is a refused read.
- **It fails closed.** If Dispatch's answer is unknown, the result is 503
  `ASSIGNMENT_UNVERIFIED` and nothing is returned. Unknown covers a timeout, a
  network failure, a 5xx, a refused credential (401/403), any other status and
  a malformed or oversized body. The 503 response is retryable.
- **No allow is cached.** Each request asks Dispatch again, so the staleness
  window is one request. A reassignment or unassignment takes effect on the
  technician's next call. The lane test proves this against the real Dispatch
  process.
- **The alternative needs an unpublished event.** Booking would have to keep a
  local copy of the assignee, fed by `dispatch.assignment-changed.v1`. That
  event is producer-pending (CR-P02-C3 §1). Even with the event, a projection
  lags, and a lagging allow is exactly the defect this route must not have.
- **Dispatch is asked before the booking is read.** Because of this order, 404
  and 503 do not reveal whether a booking id exists. An unknown id gives the
  same 404, or the same 503 when Dispatch is down.

Adapter rules:

- Per-attempt timeout is `BOOKING_DISPATCH_TIMEOUT_MS` (default 1000 ms,
  allowed range 100 to 10000).
- Total budget is 2 × timeout + 150 ms.
- At most one retry, with 0 to 150 ms of injected jitter. It retries only after
  a timeout, a network failure or a 5xx, because the request is a safe,
  idempotent GET. It never retries a 4xx or a malformed answer.
- Parsing is closed. Booking reads only `bookingId` (which must equal the
  requested id), `status` (one of the 4 values), `technicianSubjectId` (a UUID
  or null, and non-null when ASSIGNED) and `revision` (an integer ≥ 1). Other
  fields are ignored.
- The body is limited to 64 KiB. Redirects are refused.
- `x-correlation-id` and the W3C trace parent are propagated.
- The credential is `x-service-client` / `x-service-token`.

Startup validation:

- If all `BOOKING_DISPATCH_*` variables are absent, the adapter is not
  configured and every call is 503.
- If they are partly set or malformed (URL, client id, token length, timeout),
  the process refuses to start.

## Authorization matrix

Rules are checked in this order. The first rule that matches decides the
answer.

| # | Condition | Answer | Audited |
| --- | --- | --- | --- |
| 1 | No credential, unknown token, or service credential presented | 401 `AUTH_REQUIRED` | no |
| 2 | User without `work.read:assigned` (customer, operations) | 403 `AUTH_FORBIDDEN` (Dispatch not asked) | no |
| 3 | Id is not a UUID | 404 `NOT_FOUND`/`BOOKING_NOT_FOUND` | no |
| 4 | Dispatch unknown (timeout, network, 5xx, 401/403, malformed, not configured) | 503 `DEPENDENCY_UNAVAILABLE`/`ASSIGNMENT_UNVERIFIED` | no |
| 5 | Dispatch: no job (404), `UNASSIGNED`, `OFFERED` (even to the caller), `CANCELLED`, or `ASSIGNED` to another subject | 404 `NOT_FOUND`/`BOOKING_NOT_FOUND` | no |
| 6 | Booking missing, or status `PENDING_CONFIRMATION`, `REJECTED`, `CANCELLED`, `EXPIRED` | 404 (same body) | no |
| 7 | `ASSIGNED` to the caller and booking status `CONFIRMED`, `ASSIGNED`, `EN_ROUTE`, `ARRIVED`, `IN_PROGRESS` or `COMPLETED` | 200 view | yes, before the response |

`COMPLETED` remains visible so that a closed task can show its summary. Every
404 has the same envelope (code, reason, message) and never echoes the id. The
per-principal request budget (`BOOKING_USER_REQUESTS_PER_MINUTE`, process
local) applies to this route as to every Booking route, and answers 429.

## Privacy

The response is limited to the technician's task and is built field by field,
never by spreading a snapshot:

- slot zone and window;
- vehicle type, make, model and colour;
- plate (optional, as in the approved journey);
- address location (manual description, or coordinates with an optional
  description) and details;
- contact name, phone and notes;
- quote lines (`lineId`, `kind`, `definitionId`, `quantity`, `amount`);
- total;
- payment method.

The response does not contain:

- the customer subject id or principal kind;
- the quote id, quote revision, catalog revision or price-book revision;
- unit prices;
- the hold id;
- owner record ids or revisions (vehicle id, address id);
- saga state.

Who may read the contact data, and when:

- only the subject Dispatch currently reports as `ASSIGNED`;
- only while the booking is in a working status or `COMPLETED`;
- never during an offer, which is before acceptance;
- never after reassignment, which takes effect on the next request.

Operations staff keep the existing `GET /bookings/:id` (`operations.dispatch`).
This route refuses them (403), so it stays purpose-limited.

Logs and audit:

- Audit rows hold opaque ids only: actor kind `USER` and the technician
  subject, target booking id, correlation id, and
  `details {assignmentRevision, bookingRevision}`.
- Denials are recorded as observer events with the booking id and a reason
  code only.
- The error log contains code, reason and status only. Exception messages are
  redacted by the shared logger.
- Tests assert that no name, phone or customer subject appears in audit rows
  or observer output.

Retention of the read audit follows the existing `audit_entry` policy (owner
decision pending, see CR-P02-C2 §6).

## Migration

None. `app.audit_entry` already exists (`20261008100000_p02c2_booking_saga`).
`recordAudit` appends one row in its own transaction, through the same
`appendAudit` used by the saga. `schema.prisma` is unchanged.
`node scripts/check-migrations.mjs` passes.

## Evidence

Run `node scripts/production/C/verify.mjs booking` on a clean tree. The exact
head, tree and counts are in the commit report. Suites added by this child:

| Family | Suite | Real | Double |
| --- | --- | --- | --- |
| unit | `test/unit/technician-view.spec.ts` | the application query, decision functions, wire mapping and error mapping | in-memory store; Dispatch verifier stub |
| unit | `test/unit/dispatch-assignment.spec.ts` | the adapter over a real local `node:http` server and Node fetch: 200 parse, 404, 500→retry→200, 5xx twice, slow→retry, slow twice (budget), connection reset (twice, then recovered), 9 malformed bodies, 401/403/400/409/429, not configured, config validation | Dispatch's HTTP answers |
| postgres | `test/integration/technician-view.pg.spec.ts` | Nest server, PostgreSQL 16.10 (runtime role), real saga and store, real Dispatch HTTP adapter. Bookings created by `POST /bookings`. Audit row read back after the response. | Identity/owners (shared HTTP double); Dispatch (HTTP double that checks the credential) |
| lane | `tests/production/C/booking-technician-view.test.mjs` | **compiled Dispatch and Booking processes**, real Dispatch inbox store and handler (published `scheduling.hold-changed.v1` parser), real offer / accept / reassign over Dispatch HTTP, real service credential digest in `DISPATCH_SERVICE_CLIENTS`, Dispatch process SIGKILLed | Identity and Booking's owners (shared HTTP double); the hold-changed message is handed to Dispatch's inbox in process instead of through RabbitMQ (that path is covered by `dispatch-inbox-rabbitmq`) |

The lane test proves the following:

- no view before an offer, and none during an offer;
- the view after accept;
- 404 for another technician;
- after reassignment, 404 for the original technician at once, and a view for
  the new technician only after they accept;
- with the Dispatch process killed, 503 `ASSIGNMENT_UNVERIFIED` for the
  assigned technician, within the budget, and never 200;
- no audit row for denied or unverified reads.

The lane booking row is seeded through Booking's own API. No SQL fixture is
used.

## Not proven here

- **Real Identity.** Token verification and the `work.read:assigned` grant are
  Identity's (a double is used here).
- **Real network transport.** No mTLS or workload identity exists. The interim
  digest credential is used (CR §2).
- **The gateway route** `/api/operator/bookings/:id` and the operator-web
  screen that consumes it (C5, CR §3).
- **Lifecycle milestones.** Booking statuses after CONFIRMED (EN_ROUTE …
  COMPLETED) are not produced yet, because consuming
  `dispatch.task-progressed.v1` is not implemented (CR §4). Today a
  technician sees `CONFIRMED` throughout. The matrix for the later statuses is
  proven in unit tests only.
- **Load and global rate limits.** Only behaviour under load is untested, and
  the per-actor budget is process-local.
- **Multi-replica Dispatch failover.**
- **Production readiness.** `BUSINESS_READY` stays `false` and readiness stays
  503.

## Blockers

- CR-P03-C3 §1: Lane E to publish the route in `booking.v1`.
- CR-P03-C3 §2: workload identity for Booking → Dispatch `dispatch.assignment.read`
  (interim digest credential until then).
- CR-P03-C3 §3: the gateway route for operator-web.
- CR-P03-C3 §4: `dispatch.task-progressed.v1` must be published by C4 before
  Booking can consume lifecycle milestones.
- Inherited from P02-C2: Billing contract, Booking contracts, relay process.
