# CR-P02-C3 — Dispatch v1 contracts and platform prerequisites (request to Lane E)

Requester: Lane C (P02-C / C3). Implementation: `services/dispatch`.
Lane C does not edit shared packages, lockfiles, CI, infra or architecture; each
item is a request for Lane E to review, version and publish. Until then the
items below are **producer-pending / provider-pending** and nothing in Dispatch
claims them as published.

## 1. Event: `dispatch.assignment-changed.v1` (envelope v2)

Exchange `dispatch.events` (topic), routing key = event type. Producer
serialiser: `services/dispatch/src/domain/events.ts`.

```json
{
  "eventId": "uuid", "eventType": "dispatch.assignment-changed.v1", "envelopeVersion": 2,
  "producer": "dispatch", "occurredAt": "utc", "correlationId": "uuid",
  "causationId": "uuid|null", "traceparent": "w3c|null",
  "aggregate": { "type": "assignment", "id": "uuid", "version": 3 },
  "actor": { "kind": "account|service|system", "id": "uuid|service|null" },
  "data": {
    "bookingId": "uuid",
    "status": "UNASSIGNED|OFFERED|ASSIGNED|CANCELLED",
    "zoneId": "uuid",
    "startsAt": "utc", "endsAt": "utc",
    "resourceId": "uuid|null"
  }
}
```

Rules: `data` closed; `resourceId` non-null exactly when `status = ASSIGNED`;
`endsAt > startsAt`; `aggregate.version` = assignment revision (consumers apply
only newer). `causationId` is the `scheduling.hold-changed.v1` event id for
consumer-driven changes. No names, phones, addresses, plates or technician
subjects in `data`. Requested registry status: `producer: 'dispatch'`,
`contract-only` until an accepted release runs the relay.

## 2. Service dependencies (lockfile)

Add to `services/dispatch/package.json` and the lockfile:
- `@carwash/platform-messaging: workspace:*` (and its `amqplib`) to run the
  hold-changed consumer process and the outbox relay inside the service. The
  parts (`holdChangedConsumerParts`, `PrismaInboxStore`, `PrismaOutboxStore`)
  are already verified with the shared `InboxConsumer`/`OutboxRelay` against
  RabbitMQ 4.2 (`tests/production/C/dispatch-*-rabbitmq.test.mjs`).
- `@carwash/contracts: workspace:*` to import the error envelope instead of the
  local closed subset in `transport/http/http-errors.ts` (today verified
  against the published parser by `tests/production/C/dispatch-contract.test.mjs`).

Requested scripts: `start:offer-expiry` (`node dist/workers/offer-expiry.main.js`),
`test:unit`, `test:integration`.

## 3. HTTP contract `dispatch.v1` (owner: Dispatch, lane C)

Prefix `/internal/v1/dispatch`; routes and access exactly as in
`services/dispatch/README.md`. Reasons requested for the owner allowlist:
`ASSIGNMENT_NOT_FOUND`, `OFFER_NOT_FOUND`, `ASSIGNMENT_CANCELLED`,
`ASSIGNMENT_ALREADY_ASSIGNED`, `LIVE_OFFER_EXISTS`, `OFFER_NOT_LIVE`,
`OFFER_EXPIRED`, `JOB_WINDOW_PASSED`, `RESOURCE_BUSY`, `CONCURRENT_UPDATE`,
`IDENTITY_UNAVAILABLE`, `STORE_BUSY`. Commands carry `expectedRevision` in the
body; `Idempotency-Key` per the E1 convention (scope = actor + operation +
target; retention 7 days, purged by the expiry worker).

## 4. Service-to-service identity and scope

Interim: `x-service-client` / `x-service-token`, SHA-256 digests in
`DISPATCH_SERVICE_CLIENTS`, scope `dispatch.assignment.read` (Booking display).
Request the platform workload identity with this scope (same request as CR-C1 §4).

## 5. Workforce eligibility (gap, not faked)

Operations name `resourceId` and the technician's Identity subject when they
create an offer. Dispatch does **not** verify that the resource is ELIGIBLE,
works in the zone, has a shift covering the window, or that the subject belongs
to that resource: `workforce.v1` publishes only `listCapacityResources`
(`service:workforce.capacity.read`), with no subject↔resource mapping. Requests:
(a) grant Dispatch `workforce.capacity.read`; (b) a `workforce.v1` read that
resolves a resource's Identity subject (or a subject's resource) for offer
validation. Until then technician acceptance is bound to the subject operations
named, and eligibility is an operations responsibility.

## 6. Broker topology and ACL

Producer `dispatch` owns `dispatch.events` (configure/write). Subscriber
`dispatch` needs a quorum queue bound to `scheduling.events` /
`scheduling.hold-changed.v1` with a delivery limit and DLX (as declared by the
lane test), read-only on `scheduling.events`. Add the identity to
`infra/rabbitmq/acceptance-bootstrap.sh` / `BROKER_SERVICES`.

## 7. Ownership registry

`architecture/parallel-ownership.json` lease `W01-runtime-dispatch` (E,
permanent owner C) still covers shell files edited here (`app.module.ts`,
`domain/index.ts`, `application/index.ts`, `ports/index.ts`,
`infrastructure/persistence/prisma.service.ts`, `schema.prisma`, `README.md`).
Request lease expiry or explicit hand-over to C (same as CR-C1 §8).
`services/dispatch/package.json` and `src/index.ts` are unchanged.

## 8. Upstream dependency

Dispatch opens jobs from `scheduling.hold-changed.v1` with `state = COMMITTED`.
The scheduling provider on `main` still emits the C1 events
(`hold-created.v1`, `hold-expired.v1`); the hold-changed producer is the
scheduling v1 conformance child (P02-C1). End-to-end flow requires that child
merged and the broker topology above.
