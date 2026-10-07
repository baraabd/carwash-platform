# CR-C1 — Scheduling v1 contracts and platform prerequisites (request to Lane E)

Requester: Lane C (P01-C / C1). Producer implementation: `services/scheduling`.
Lane C does not edit shared packages, lockfiles, CI, infra or architecture; each
item below is a request for Lane E to review, version and publish.

## 1. Event contracts (`@carwash/event-contracts`)

Exchange `scheduling.events` (topic), routing key = event type. Envelope
identical to `booking.confirmed.v1`. All ids are UUID strings; instants are
canonical UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`). No personal data.

### `scheduling.hold-created.v1`

```json
{
  "eventId": "uuid", "eventType": "scheduling.hold-created.v1", "schemaVersion": 1,
  "producer": "scheduling", "occurredAt": "utc", "correlationId": "uuid",
  "aggregateVersion": 1,
  "data": {
    "holdId": "uuid", "windowId": "uuid", "zoneId": "uuid", "holderRef": "uuid",
    "units": 1, "windowStartsAt": "utc", "windowEndsAt": "utc", "expiresAt": "utc"
  }
}
```

### `scheduling.hold-expired.v1`

```json
{
  "eventId": "uuid", "eventType": "scheduling.hold-expired.v1", "schemaVersion": 1,
  "producer": "scheduling", "occurredAt": "utc", "correlationId": "uuid",
  "aggregateVersion": 2,
  "data": {
    "holdId": "uuid", "windowId": "uuid", "zoneId": "uuid", "holderRef": "uuid",
    "units": 1, "expiredAt": "utc"
  }
}
```

`expiredAt` is the hold's deadline; `occurredAt` is when expiry was recorded.
`units` is an integer 1–4. Requested registry status: `producer: 'scheduling'`,
`status: 'contract-only'` until the relay below runs in an accepted release.
Producer-side serialisers: `services/scheduling/src/domain/events.ts`.

## 2. Service dependencies (lockfile)

Add to `services/scheduling/package.json` and the lockfile:
- `@carwash/platform-messaging: workspace:*` — to run the outbox relay process
  (`PrismaOutboxStore` already matches `OutboxStore`; verified with the shared
  `OutboxRelay` against RabbitMQ 4.2).
- `@carwash/contracts: workspace:*` — to type the HTTP API and Identity session
  view from the published contract instead of the local anti-corruption parse.

## 3. Identity permission

Add `scheduling.capacity.manage` to `IDENTITY_PERMISSIONS` and to the
`operations` role. Until then capacity management requires
`operations.dispatch` (documented in `application/authorization.ts`).

## 4. Service-to-service identity

Scheduling currently accepts `x-service-client` / `x-service-token` with
SHA-256 digests in `SCHEDULING_SERVICE_CLIENTS` and scopes
`scheduling.holds.write`, `scheduling.availability.read`. Request: a platform
workload identity (mTLS or signed service tokens) with these scopes, provisioned
secrets per environment, and rotation. Scheduling will switch to it and remove
the interim mechanism.

## 5. Gateway routes (`@carwash/contracts` gateway registry)

Proposed customer/operations routes (Booking calls holds directly, never via the
public gateway):

| id | method | path | upstream | permission |
| --- | --- | --- | --- | --- |
| `customer.availability` | GET | `/availability` | `/internal/v1/scheduling/availability` | `bookings.create:self` |
| `admin.capacity.define` | POST | `/admin/capacity/windows` | `/internal/v1/scheduling/windows` | `scheduling.capacity.manage` |
| `admin.capacity.change` | PATCH | `/admin/capacity/windows/:id` | `/internal/v1/scheduling/windows/:id/capacity` | `scheduling.capacity.manage` |

The availability route needs query-string forwarding (`zoneId`, `from`, `to`),
which `routeMatch` currently rejects (`raw.includes('?')`). That is a gateway
change for E to decide.

## 6. Broker topology and ACL

Producer `scheduling` owns exchange `scheduling.events` (configure/write);
Booking will bind its own queue (read). The relay connection identity must be
added to `infra/rabbitmq/acceptance-bootstrap.sh` / `BROKER_SERVICES`.

## 7. Catalog status

Once 1–2 merge: `architecture/service-catalog.json` scheduling
`api.status` and `events.status` can move from `planned-not-implemented` to an
implemented-but-unaccepted state; `runtimeImplementation` stays as E decides.
`BUSINESS_READY` remains `false` until release acceptance on exact source.
