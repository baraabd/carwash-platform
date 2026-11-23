# CR-P02-C2 — Booking v1 contracts and platform prerequisites (request to Lane E)

Requester: Lane C (P02-C / C2). Producer/consumer implementation: `services/booking`.
Lane C does not edit shared packages, lockfiles, CI, infra or architecture; each
item is a request for Lane E to review, version and publish. Until then every
shape below is marked REQUESTED in code and docs and nothing claims it is published.

## 1. HTTP contract `booking.v1` (owner: Booking)

Prefix `/internal/v1/booking`.

| id | method/path | access | notes |
| --- | --- | --- | --- |
| createBooking | `POST /bookings` | principal (`bookings.create:self`), idempotent | 201 created, 200 replay |
| getBooking | `GET /bookings/:bookingId` | principal owner (`bookings.read:self`) or `operations.dispatch` | other principal → 404 |

```ts
interface CreateBookingRequestV1 {          // closed
  quote: { quoteId: string; revision: number };
  hold: { holdId: string; revision: number };
  vehicle:
    | { source: 'saved'; vehicleId: string; revision: number }
    | { source: 'inline'; inline: { type: VehicleType; make?: string | null; model?: string | null;
        color?: string | null; plate?: { text: string; region?: string | null } | null } };
  address: { addressId: string; revision: number };
  contact: { name: string; phone: string; notes: string | null };
  paymentMethod: 'CASH_ON_COMPLETION' | 'SHAM_CASH' | 'SYRIATEL_CASH';   // Lane B vocabulary (CR-B-01)
}

interface BookingV1 {
  bookingId: string; revision: number;
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED'
        | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED';
  confirmation: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'NEEDS_ATTENTION';
  rejectionReason: 'QUOTE_EXPIRED' | 'QUOTE_REVOKED' | 'QUOTE_INVALID' | 'OBLIGATION_REJECTED'
                 | 'HOLD_EXPIRED' | 'HOLD_UNAVAILABLE' | 'DEADLINE_EXCEEDED' | null;
  beneficiary: PrincipalRef;
  paymentMethod: PaymentMethodV1;
  slot: { holdId: string; zoneId: string; startsAt: UtcTimestamp; endsAt: UtcTimestamp; committed: boolean };
  quote: { quoteId: string; revision: number; catalogRevision: number; priceBookRevision: number;
           lines: QuoteLineV1[] };
  total: Money;
  vehicle: VehicleSnapshotV1; address: AddressSnapshotV1;
  contact: { name: string; phone: string /* E.164 */; notes: string | null };
  createdAt: UtcTimestamp; updatedAt: UtcTimestamp; confirmedAt: UtcTimestamp | null;
}
```

Reasons (owner allowlist): `HOLD_ALREADY_BOOKED`, `QUOTE_ALREADY_BOOKED`,
`QUOTE_EXPIRED`, `QUOTE_REVOKED`, `QUOTE_NOT_FOUND`, `REVISION_MISMATCH`,
`HOLD_NOT_ACTIVE`, `HOLD_NOT_FOUND`, `VEHICLE_TYPE_MISMATCH`, `ZONE_MISMATCH`,
`SLOT_STARTED`, `VEHICLE_ARCHIVED`, `ADDRESS_NOT_FOUND`, `VEHICLE_NOT_FOUND`,
`STORE_BUSY`. Producer: `services/booking/src/transport/http/booking-view.ts`.

## 2. Dependencies (lockfile)

Add to `services/booking/package.json` and the lockfile:
- `@carwash/contracts: workspace:*` — replace the local anti-corruption parsers
  (`infrastructure/owners/contract-acl.ts`, kept honest meanwhile by
  `tests/production/C/booking-contract-parity.test.mjs`) and type the error envelope.
- `@carwash/api-clients: workspace:*` — typed owner calls.
- `@carwash/platform-messaging: workspace:*` — run the outbox relay as a process
  (`PrismaOutboxStore` already drives the shared `OutboxRelay` against RabbitMQ 4.2).
- Script requests (package.json is E-owned): `start:saga-worker`
  (`node dist/workers/saga.main.js`), `test:unit`, `test:integration`.

## 3. Billing saga contract (owner: Billing, Lane B) — aligns with CR-B-01/CR-B-03

Booking needs, under a workload scope (proposed `service:billing.obligation.write`):

| id | method/path | body | success |
| --- | --- | --- | --- |
| createObligationForBooking | `POST /internal/v1/billing/obligations` | `{ beneficiary: PrincipalRef, quoteId, bookingId }`, `Idempotency-Key` | 201/200 `ObligationV1` (CR-B-01), same obligation for a repeated booking id |
| voidObligationForBooking | `POST /internal/v1/billing/obligations/void-for-booking` | `{ bookingId, reason: 'BOOKING_FAILED' }`, `Idempotency-Key` | 200, also when no obligation exists |

Required semantics: idempotent by booking id; void by **booking id** (the saga
may not know the obligation id when a create timed out); a void leaves a
tombstone so a create that arrives later is refused (422) and can never
resurrect a compensated booking. Booking verifies the returned `quoteId` and
`amount` against its snapshot and refuses a mismatch.
Until this is published, `BILLING_URL` stays unset in every environment and
every booking is rejected (`DEADLINE_EXCEEDED`) before its pivot — fail closed.

## 4. Event contract `booking.created.v1` (envelope v2, producer `booking`)

Exchange `booking.events` (topic), routing key = event type, aggregate type
`booking`, actor = the beneficiary principal. Emitted once, when CONFIRMED.

```json
{ "status": "CONFIRMED", "beneficiary": {"kind": "account|guest", "subjectId": "uuid"},
  "zoneId": "uuid", "startsAt": "utc", "endsAt": "utc", "holdId": "uuid",
  "quoteId": "uuid", "quoteRevision": 1,
  "total": {"currency": "SYP", "amountMinor": "9000000", "scale": 2},
  "paymentMethod": "CASH_ON_COMPLETION" }
```

No name, phone, address, coordinates or plate. Producer:
`services/booking/src/domain/events.ts`; envelope-v2 validity is asserted with the
published parser. Requested registry status: `producer-pending`.
`booking.confirmed.v1` (envelope v1) is NOT emitted: its required `customerId`
has no source for guests or for a service-side saga; its guest-capable successor
is this event (E1 doc: "belongs to the Booking (P02) set").

## 5. Scopes, identity and gateway

- Grants for Booking's workload identity: `scheduling.hold.commit` (C1),
  `pricing.quote.validate`, `vehicle.snapshot.resolve`,
  `customer.address-snapshot.resolve`, `billing.obligation.write` (§3). Until
  workload identity lands, interim per-owner credentials
  (`BOOKING_TOKEN_<OWNER>`, client id `booking`) with digests on the owner side.
- On-behalf reads: Booking forwards the principal's bearer only to
  pricing.v1 `getQuote` and scheduling.v1 `getHold` during the principal's own
  request. Request an explicit decision: keep on-behalf reads, or add
  service-scoped `getQuoteForBooking` / `getHoldForBooking` routes.
- Gateway routes: `customer.bookings.create` `POST /bookings` and
  `customer.bookings.get` `GET /bookings/:bookingId` → booking.v1, public modes
  account and guest.

## 6. Decisions requested from owner/product

- Idempotency-key retention for bookings (now: as long as the booking).
- Pre-pivot deadline (now 10 minutes = hold lifetime).
- Whether an address must be checked by Geo against the hold's zone before
  confirmation (Geo has no approved zone data; not implemented).

## 7. Broker topology and ACL

Producer `booking` owns exchange `booking.events` (configure/write); the relay
connection identity must be added to the broker bootstrap.

## 8. Catalog / ownership

`architecture/service-catalog.json` booking api/events status, and
`architecture/parallel-ownership.json` hand-over of `services/booking/**` shell
files and `docs|scripts|tests/production/C/**` to Lane C (same ask as CR-C1 §8).
