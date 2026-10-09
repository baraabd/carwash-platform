# CR-P03-C4 — Dispatch task execution contracts (request to Lane E)

Requester: Lane C (P03-C / C4). Implementation: `services/dispatch`. Lane C edits no shared package,
lockfile, CI, infra or architecture file; every item is a request to review, version and publish.

## 1. Events (envelope v2, exchange `dispatch.events`, routing key = event type)

`dispatch.task-progressed.v1` — aggregate `{type:'task', id, version}`. Closed data:

```json
{ "bookingId": "uuid", "assignmentId": "uuid", "taskId": "uuid",
  "stage": "ACCEPTED|EN_ROUTE|ARRIVED|IN_SERVICE|DOCUMENTING|FINISHED|CLOSED|RELEASED|WITHDRAWN|CANCELLED" }
```

Consumers: Booking (lifecycle `ASSIGNED→EN_ROUTE→ARRIVED→IN_PROGRESS→COMPLETED`, applying only newer
`aggregate.version`), Reporting, Communications.

`dispatch.cash-declared.v1` — aggregate task. Closed data:

```json
{ "bookingId": "uuid", "taskId": "uuid", "outcome": "CASH_COLLECTED|CASH_NOT_COLLECTED|NOT_CASH",
  "amount": { "currency": "SYP|USD", "amountMinor": "integer string", "scale": 2 } | null, "late": false }
```

A declaration is not a receipt. Billing reconciles it against its own receipts (P03-B1).

Producer serialisers: `services/dispatch/src/domain/events.ts`. They are verified against the published generic
`parseEnvelopeV2` by `tests/production/C/dispatch-workforce-contract.test.mjs`.

## 2. HTTP `dispatch.v1` additions

Routes, bodies, views and reasons as in `docs/production/C/P03-C-interfaces.md` §C4 and
`docs/production/C/P03-C4-dispatch-task-execution.md`. New reasons for the owner allowlist:

- `RESOURCE_INELIGIBLE`, `ELIGIBILITY_UNAVAILABLE`
- `TASK_NOT_FOUND`, `TASK_CLOSED`, `TASK_STAGE_INVALID`, `TECHNICIAN_BUSY`
- `CHECK_NOT_FOUND`, `CHECKLIST_INCOMPLETE`
- `EVIDENCE_REQUIRED`, `EVIDENCE_INVALID`, `EVIDENCE_IN_USE`, `EVIDENCE_UNAVAILABLE`
- `COLLECTION_NOT_OPEN`

`GET /me/bookings/:bookingId/work` is the requested work-owner read for Billing's `WorkAuthority`
(P03-B1 blocker B-P03-01). Billing composes it with Booking's `quoteId`; see §6.

workforce.v1 limitation: `CapacityResourceV1.shifts` carries no zone, so a resource with shifts in several
zones cannot be checked per shift. Request a per-shift `zoneId` in a v1-compatible addition.

## 3. Gateway routes for operator-web

Requested in `CR-P03-C5-operator-gateway.md`. The Dispatch upstreams are the technician routes above.

## 4. Broker topology and ACL

Subscriber `dispatch` needs a quorum queue bound to `workforce.events` /
`workforce.eligibility-changed.v1`, with a delivery limit and a DLX. The lane test declares exactly that. It
needs read-only access on `workforce.events`.

## 5. Dependencies and identity (unchanged from CR-P02-C3 §2/§4)

- `@carwash/platform-messaging` and `@carwash/contracts` for the consumer and relay processes.
- Workload identity with these scopes:
  - Dispatch → Workforce `workforce.capacity.read`;
  - Dispatch → Media `media.object.read` and `media.object.claim`;
  - Booking → Dispatch `dispatch.assignment.read`.

## 6. Cross-lane notes

- **Billing (Lane B, #111):** a `WorkAuthority` adapter can read Dispatch `GET /me/bookings/:id/work` with
  the technician's credential (`workState`, `assignmentId`, `assignmentRevision`, `technicianSubjectId`), and
  Booking's technician view for `quoteId`. Booking's view currently omits `quoteId`; adding it is a
  one-line Lane C change once E/B confirm the composition.
- **Workforce availability (ready/break)** is not part of eligibility. Dispatch does not yet consume it for new
  offers (CR-P03-C1 §4).
