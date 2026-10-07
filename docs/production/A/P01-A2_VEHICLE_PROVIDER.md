# P01-A2 — Vehicle production provider

Status: **IMPLEMENTED, INTEGRATION_PENDING.** The provider runs against real PostgreSQL and the
real Identity service in the Lane A harness. It is not production-ready, and readiness stays 503
(`BUSINESS_READY = false`).

This child is independent of P01-A1 (Customer). Both are based on `main`, and neither consumes
the other. The shared harness files (`scripts/production/A/*.mjs`, `tests/production/A/_support.mjs`)
are byte-identical to the copies in P01-A1, so either merge order is clean.

## Scope

- Saved vehicles:
  - Type from the approved alphabet `sedan|suv|large|pickup`.
  - Optional name (≤60), optional plate (≤20), optional colour (≤30).
- List, read, edit and archive, with `If-Match` revisions and `Idempotency-Key` on create.
- Transactional outbox rows (`vehicle.vehicle-updated.v1`, references only) and append-only
  audit facts.
- Not in scope:
  - Booking snapshots. Booking stores immutable vehicle snapshots later; Vehicle exposes source
    records only.
  - Catalog vehicle-class pricing mapping.
  - Any UI change.

## Decisions (recorded for owner and E review)

- **A2-D1 — owner key.**
  - Rule: a vehicle is owned by the authenticated principal, keyed by `owner_kind` plus the
    Identity subject. It is not keyed by a Customer `customerId` that would be fetched
    synchronously.
  - Why: Customer maps one-to-one onto the same principal. Keying on the principal therefore
    removes a synchronous Customer dependency, and with it a failure mode, without weakening
    ownership.
  - Booking can resolve both records from one principal.
  - The proposal in `docs/parallel/A/W02/ENTRY_CONTRACT_PACKET.md` §6 suggested Customer
    resolution. This difference is declared here, not hidden.
- **A2-D2 — no deduplication by plate.**
  - Saving is an explicit create plus an update by id.
  - The prototype's upsert by plate+type, or by name+type+colour, changes deduplication
    semantics. That needs an owner decision, so the server does not reproduce it.
  - Plates are never unique, globally or per owner. A plate never links records, and it is not
    proof of title.
- **A2-D3 — permissions.**
  - Identity V1 has no vehicle permission. `profile.read:self` and `profile.write:self` gate saved
    vehicles, because they are part of the customer's own data.
  - A narrower permission is request A-P01-08.
- **Limit.**
  - `VEHICLE_MAX_ACTIVE_VEHICLES` (default 100) is a technical abuse ceiling.
  - The prototype's 30 is a demo cap, not policy.
  - Concurrent creates for one owner are serialised by a transaction-scoped advisory lock.

## Data (migration `20261007110000_p01a_vehicles`, additive)

- `vehicle`
  - Columns: `owner_kind`, `owner_subject`, `vehicle_type`, `display_name`, `plate`, `color`,
    `status`, `revision`, `archived_at` and timestamps.
  - CHECKs:
    - owner kind, type and status values;
    - `revision >= 1`;
    - `archived_at` is set exactly when the vehicle is archived;
    - plate shape: 2–20 Latin or Arabic letters, digits, single spaces or hyphens; at least one
      digit; stored trimmed. Each multi-value test is NULL-guarded.
  - Index `(owner_kind, owner_subject, status)`.
- `idempotency_record`, `outbox_message`, `audit_entry` follow the same patterns as P01-A1. The
  audit trigger refuses UPDATE and DELETE with SQLSTATE 42501.

Rollback:

- Before any rows exist, drop the four tables and the trigger function.
- After rows exist, rollback needs a reviewed data plan.
- The application can roll back on its own.

## HTTP API (`/internal/v1/vehicle`, proposed `vehicle.v1`)

| Method and path                 | Preconditions              | Result                               |
| ------------------------------- | -------------------------- | ------------------------------------ |
| `GET /mine?includeArchived=`    | read session               | `{ items }`, caller's vehicles only  |
| `POST /`                        | `Idempotency-Key` required | 201; a replay returns the same body  |
| `GET /:vehicleId`               | owner only                 | 200, or 404 for missing or not owned |
| `PATCH /:vehicleId`             | `If-Match`                 | 200, 404, 409 archived, 412, 428     |
| `POST /:vehicleId/archive`      | `If-Match`                 | 200; already archived returns 200    |

`VehicleView`: `{vehicleId, type, displayName|null, plate|null, color|null, status, revision,
createdAt, updatedAt, archivedAt|null}`.

The view deliberately has no owner field. Owner fields in a request body are refused with 422
`INVALID_INPUT`. An edit to a missing vehicle returns 404 and never creates one; this fixes the
W08 threat-register item.

Errors use the shared envelope.

- Validation, all 422: `INVALID_VEHICLE_TYPE`, `INVALID_PLATE`, `INVALID_DISPLAY_NAME`,
  `INVALID_COLOR`, `INVALID_INPUT`.
- 409: `VEHICLE_LIMIT_REACHED`, `VEHICLE_ARCHIVED`.
- Authentication, revision and idempotency errors use the same codes as P01-A1.

## Authorization and resilience

- Authorization works the same way as P01-A1. Identity confirms the current session. A cookie
  write goes through Identity's CSRF and origin check.
- The service fails closed:
  - no Identity origin configured (`VEHICLE_IDENTITY_ORIGIN`): 503;
  - timeout (`VEHICLE_IDENTITY_TIMEOUT_MS`, 2 s by default, no retry): 503;
  - outage or a malformed response: 503;
  - an invalid configuration stops startup.

## Evidence

- Unit, domain and framework tests: `pnpm --filter @carwash/vehicle run test:unit` (16 tests).
- Real infrastructure: `node scripts/production/A/acceptance-a.mjs --services vehicle`.
  - The run covers the auth, revocation and CSRF path.
  - It proves the owner comes from the session and that body owner fields are refused.
  - It proves plates are not unique.
  - It checks 404 for another owner's vehicle and for an edit to a missing vehicle.
  - Concurrency checks: 8 creates with one key produce 1 vehicle and 1 event. Concurrent edits
    produce one 200 and the rest 412. The active-vehicle ceiling holds under concurrency.
  - PostgreSQL CHECKs (23514) and the audit trigger (42501) are exercised directly.
  - It checks that events carry no plate, name, colour or owner.
  - It checks that guest and account principals stay separate, that the database role cannot
    reach another service's database, and that an Identity outage returns 503 without a write.
  - The evidence JSON lives in `docs/production/A/evidence/`.

## Contract requests

| ID       | Request                                                                     | Owner          |
| -------- | --------------------------------------------------------------------------- | -------------- |
| A-P01-06 | Publish `vehicle.v1` HTTP contract and client (routes and view above)       | Lane E         |
| A-P01-07 | Gateway: add `vehicle` to `GatewayOwner`, route `/api/v1/customer/vehicles` | Lane E         |
| A-P01-08 | Optional narrower Identity permission for saved vehicles                    | Identity/E     |
| A-P01-09 | Register `vehicle.vehicle-updated.v1`; add `washgo.vehicle.events` and its ACL; add the relay dependency | Lane E |
| A-P01-10 | Accept or replace A2-D1 (principal-keyed ownership)                         | Owner/E        |
| A-P01-11 | Owner decision on garage deduplication (A2-D2)                              | Owner          |

Guest vehicles depend on the same Identity guest-session request as Customer (A-P01-04).

Next consumers:

- Booking resolves an owned, active vehicle into its own immutable snapshot.
- Pricing maps the vehicle type to a catalogue class once that mapping is accepted.
- customer-web connects through the gateway after A-P01-07.
