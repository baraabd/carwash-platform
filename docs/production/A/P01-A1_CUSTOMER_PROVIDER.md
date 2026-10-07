# P01-A1 — Customer production provider

Status: **IMPLEMENTED, INTEGRATION_PENDING.** The capability runs against real PostgreSQL and
the real Identity service in the Lane A acceptance harness. It is not production-ready: the
gateway route, event registration/relay, guest sessions and exact-source release acceptance
are still open (see "Blockers"). `BUSINESS_READY` stays `false`, so readiness keeps returning 503.

## Scope

| In this child                                         | Not in this child                                   |
| ----------------------------------------------------- | --------------------------------------------------- |
| Customer profile (name, phone, preferred locale)      | Vehicles (P01-A2) and service zones (P01-A3)        |
| Saved addresses (manual or EPSG:4326 coordinates)     | Booking snapshots. Booking owns those later         |
| Archive, revisions/ETag, idempotent mutations         | Consent/preferences policy. Not approved yet        |
| Transactional outbox rows, audit facts                | Broker relay. Needs event registration (Lane E)     |
| Identity-backed authorization, fail-closed            | Guest sessions and claim. Identity contract pending |

No customer-web file changed. The approved UI is untouched, and no design reference, hash or
threshold was modified.

## Architecture

```
transport/http/customer.controller.ts   HTTP <-> application; error mapping; no rules
application/customer.application.ts     use cases; idempotency; revision checks; events; audit
domain/*                                pure rules: contact, coordinates, address, profile
ports/customer.ports.ts                 Clock, IdGenerator, IdentityAuthorizer, CustomerStore
infrastructure/persistence/*            Prisma adapter (the only code that knows table names)
infrastructure/identity/*               HTTP adapter to Identity's session/authorize endpoints
app.module.ts                           composition root
```

The layer guard (`scripts/check-layers.mjs`) passes. Domain, application and ports import no
Nest, Prisma or pg code.

## Data (migration `20261007100000_p01a_customer_profiles_addresses`)

Additive (expand-only). It is applied by `cw_customer_migrate`. The runtime role `cw_customer_app`
gets DML only through the repository's existing default privileges.

- `customer_profile`
  - Contains `id` (the Customer-owned customer id), `principal_kind` (`account|guest`),
    `principal_subject` (the Identity subject), `display_name`, `phone`, `preferred_locale` and
    `revision`.
  - `UNIQUE(principal_kind, principal_subject)` means one profile per principal.
  - CHECKs cover the kind, locale, phone shape, name length and `revision >= 1`.
- `customer_address`
  - Each row belongs to one profile through a same-service FK with `ON DELETE RESTRICT`.
  - Coordinates are `NUMERIC(9,6)`.
  - A CHECK requires one of two consistent shapes. A manual address has no source and no
    coordinates. A coordinates address has a non-null source in `pin|device|geocoder`, finite
    (non-NaN) values, latitude in [-90, 90] and longitude in [-180, 180].
- `idempotency_record`
  - The primary key is `(scope, key)`. The record stores the fingerprint, response status and
    response body. CHECKs cover key shape, fingerprint shape and response completeness.
- `outbox_message`
  - Same shape as the catalog outbox, including `trace_parent`.
- `audit_entry`
  - Identifiers only. A trigger refuses UPDATE and DELETE with SQLSTATE 42501.

Prisma schema/database mirror is verified by `prisma migrate diff --exit-code` on every
acceptance run.

Rollback:

- Before any row exists, drop the five tables, then the trigger function.
- Once rows exist, rollback is a reviewed data plan, never a silent drop. The application can
  be rolled back on its own: the previous image ignores the new tables.

## HTTP API (`/internal/v1/customer`, proposed `customer.v1`)

| Method and path                  | Preconditions                     | Result                                      |
| -------------------------------- | --------------------------------- | ------------------------------------------- |
| `POST /me`                       | write session                     | 201 created, or 200 for an existing profile |
| `GET /me`                        | read session                      | 200 with `ETag: "<revision>"`, or 404       |
| `PATCH /me`                      | `If-Match`, optional idempotency  | 200, 412 stale, 428 missing                 |
| `GET /me/addresses`              | `?includeArchived=true` optional  | `{ items }`, owner only                     |
| `POST /me/addresses`             | `Idempotency-Key` required        | 201; a replay returns the same body         |
| `GET /me/addresses/:id`          | owner only                        | 200, or 404 for missing or not owned        |
| `PATCH /me/addresses/:id`        | `If-Match`                        | 200, 409 archived, 412, 428                 |
| `POST /me/addresses/:id/archive` | `If-Match`                        | 200; already archived returns 200           |

Every response sets `Cache-Control: no-store`. Errors use the shared envelope
`{error:{code,message,correlationId,status}}`, and messages never echo input values. Body limit:
16 KiB.

Field rules follow the approved screens:

- Name: 2–60 characters.
- Phone: optional `+`, then 8–15 digits. Arabic-Indic digits and the separators `()` and `-`
  are accepted, and the number is stored normalized. This is a format check only, not
  reachability.
- Address: label up to 30 characters, line up to 160, access note up to 160.
- Coordinates are exact decimal strings with at most 6 fractional digits. Numbers, NaN,
  Infinity, exponent notation and the prototype map's x/y artwork offsets are refused.
- A manual address is unresolved for serviceability. It is never treated as serviceable by
  default.

## Authorization

- The service asks Identity whether the presented session is current. A bearer token or a
  read uses `GET /internal/v1/identity/session`. A cookie write uses `POST .../authorize`, so
  Identity's signed CSRF and origin checks still apply.
- A revoked session is refused even though its token signature is still valid. The real
  harness tests this.
- Required permissions are `profile.read:self` and `profile.write:self`. Identity grants both
  to the customer role.
- Object access: every address query is scoped by the caller's own `customer_id`. A missing
  address and another customer's address both return 404.
- Fail closed:
  - No configured Identity origin: every business call returns 503 `IDENTITY_UNAVAILABLE`.
  - Timeout (2 s by default, no retry), transport error, 5xx or a malformed body: also 503.
  - An invalid origin configuration stops startup.
- Credentials are forwarded only to Identity. Only Identity's own cookies are forwarded, and
  credentials are never logged or stored.

## Idempotency and concurrency

- The idempotency claim, the state change, the outbox row and the audit row commit in one local
  transaction.
  - A concurrent duplicate blocks on the primary key, then replays the committed answer and
    sets the `Idempotent-Replayed: true` header.
  - A failed attempt rolls back its claim, so a retry with the same key is safe.
  - The same key with a different payload returns 422 `IDEMPOTENCY_KEY_REUSED`.
  - Keys are scoped per principal and expire after 24 h, indexed on `expires_at`.
- Updates are compare-and-set on `revision`. With concurrent writers, exactly one wins and the
  others get 412.
- Address creation locks the owner's profile row. That serializes the active-address ceiling,
  which is a technical abuse limit: 100 by default, set by `CUSTOMER_MAX_ACTIVE_ADDRESSES`. The
  prototype's 20 is a demo cap, not policy.
- Profile bootstrap uses the principal unique constraint. Ten concurrent calls create exactly
  one row.

Purging expired idempotency records is an operational job for the release runbook. Expired
records cannot affect correctness, because every key is scoped by principal and fingerprinted.

## Events (outbox only; proposed `customer.profile-updated.v1`, `customer.address-updated.v1`)

The envelope follows the shared shape: `eventId`, `eventType`, `schemaVersion`, `producer`,
`occurredAt`, `correlationId`, `aggregateVersion` and `data`. Each event's `data` holds only
references, a `change` value and, for addresses, a `status`. Events never carry a name, phone,
address text, note, coordinate or Identity subject; the harness asserts this. The provisional
exchange is `washgo.customer.events`, and the routing key is the event type.

The relay is not started. Registration in `@carwash/event-contracts`, broker topology/ACL and
the `@carwash/platform-messaging` dependency all belong to Lane E (request A-P01-03). Until then
rows remain pending. Readiness stays 503, so no environment can mistake pending rows for
delivery.

## Guest and account semantics

- The model keeps `account` and `guest` as different principal kinds. A guest row with the same
  subject value is a different customer.
- Profiles are never linked or merged by phone, name, address or plate. Two accounts with one
  phone number remain two customers. Tested on real PostgreSQL.
- Identity V1 issues account sessions only, so no HTTP path can produce a guest principal today.
- Guest sessions, and claiming a guest record into an account, are blocked on an Identity
  contract (request A-P01-04) and an owner decision on claim, recovery, lifetime and cleanup.
  No implicit transition is implemented.

## Evidence

- Unit and domain tests: `pnpm --filter @carwash/customer run test:unit`.
- Real infrastructure: `node scripts/production/A/acceptance-a.mjs --services customer`.
  - It starts a disposable PostgreSQL 16 with `infra/postgres/provision.sh` least-privilege
    roles, a Redis instance, and the real Identity and Customer applications.
  - Its JSON summary is written to `docs/production/A/evidence/`, with no secrets.
  - The summary records the exact HEAD and tree, image digests, every phase and the test counts.

Defect found by the real database and fixed before commit:

- The first location CHECK used `location_source IN (...)`, which is NULL, and therefore passes
  the CHECK, when the source is NULL.
- The PostgreSQL test `coordinates: PostgreSQL itself refuses…` failed on that run.
- The CHECK now requires `IS NOT NULL` first. The migration had never been merged or applied to
  a shared environment, so the unmerged file was corrected rather than appended.

## Blockers (external to this child)

| ID       | Blocker                                                                  | Owner          |
| -------- | ------------------------------------------------------------------------ | -------------- |
| A-P01-01 | Publish `customer.v1` HTTP contract and generated client                 | Lane E         |
| A-P01-02 | Gateway route `/api/v1/customer/*` to these endpoints                    | Lane E         |
| A-P01-03 | Register events, broker topology/ACL, relay dependency for customer      | Lane E         |
| A-P01-04 | Identity guest session plus claim/link contract; owner decision on claim | Identity/Owner |
| A-P01-05 | Consent and preference policy (customer_consents)                        | Owner          |

Next consumer: Booking, for booking-owner and address snapshot resolution, once A-P01-01 is
published. The customer-web contact and address steps consume it through the gateway once
A-P01-02 exists.
