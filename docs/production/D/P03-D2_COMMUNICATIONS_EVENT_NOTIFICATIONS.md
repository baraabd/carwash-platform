# P03-D2: Communications event-driven notifications and staff visibility

Parent task: P03-D, "admin live operations and cash finance operations".
Parent status: **INTEGRATION_PENDING**.

This child makes Communications consume a real, **published** business event
and turn it into a notification intent. It also gives staff a read-only view
of delivery state per booking. Communications stays the owner of delivery
facts only. It never becomes the source of truth for the booking.

It is not production-ready and not deployed. No producer emits the event on
the accepted topology, and no delivery provider exists (an external blocker,
P01-D2).

## Scope

| Path | Change |
| --- | --- |
| `services/communications/src/domain/notification.ts` | Optional `subject` (opaque owner reference) on a request. It is appended to the fingerprint only when present, so P01-D2 fingerprints are unchanged |
| `services/communications/src/domain/event-notifications.ts` | Pure trigger policy: `booking.confirmed.v1` maps to one SMS intent per booking, with an expiry derived from the event and a late skip |
| `services/communications/src/application/event-notifications.service.ts` | Published-contract parser and a handler that runs inside the inbox transaction |
| `services/communications/src/application/notification-reads.ts` | Staff read rules, a per-subject budget, and input validation |
| `services/communications/src/infrastructure/persistence/prisma-notification.repository.ts` | Persists the subject. `PrismaNotificationReader` is a keyset-paged staff view that returns no recipient, parameters or provider ids |
| `services/communications/src/infrastructure/identity/identity-session.client.ts` | Fail-closed Identity `/session` client, plus `UnconfiguredSessionAuthority` (always 503) |
| `services/communications/src/infrastructure/messaging/event-notifications-topology.ts` | Subscriber-owned queue, DLX and DLQ |
| `services/communications/src/inbox/event-notifications-consumer.runner.ts` | Worker: the inbox row and the intent commit in one transaction, then the ACK |
| `services/communications/src/transport/http/notifications.controller.ts`, `create-app.ts` | `GET /internal/v1/communications/notifications[/:id]`. The service error filter is installed, so access errors are 401/403/429/503 and never 500 |
| `services/communications/prisma/migrations/20261010090000_p03d_notification_subject` | Additive migration |
| `tests/production/D/communications-event-notifications.test.mjs` | Real RabbitMQ, PostgreSQL and Identity suites |
| `tests/production/D/_identity.mjs`, `scripts/production/D/run-real-infra.mjs` | Byte-identical to P02-D1/P03-D1 (real-Identity harness) |

No shared package, lockfile, Gateway, CI or another lane's service is changed.

## Event to intent

The only trigger is the published `booking.confirmed.v1`, parsed with
`parseBookingConfirmedV1`. Anything else is dead-lettered.

| Field | Value | Why |
| --- | --- | --- |
| `sourceService` / `idempotencyKey` | `booking` / `booking-confirmed:<bookingId>` | One message per booking, whatever event id carried it |
| `recipientRef` | `data.customerId` (opaque) | Resolved to an address by an authorized adapter at send time; never stored |
| `channel`, `template` | `SMS`, `booking.confirmed` v1 | There are no published contact preferences yet (CR-D-P03-07) |
| `parameters` | `{ bookingRef }`, the first 8 hex characters of the booking id, uppercase | No name, phone, address, plate or price |
| `expiresAt` | `occurredAt + 6 h` | Derived from the event, so every redelivery and every replica fingerprints identically |
| `subject` | `{ type: "booking", ref: bookingId }` | Lets staff find a booking's notifications |

Outcomes:

- **CREATED.**
- **REPLAYED:** the same booking arrives under a new event id. The inbox
  applies the event, and the business key returns the existing intent.
- **SKIPPED (`TOO_LATE`):** the confirmation is past its window. The inbox
  records the event, and no intent is created. A backlog never sends stale
  messages.
- **Integrity conflict:** the same booking arrives with a different customer.
  The transaction rolls back, the delivery is NACKed, and the broker
  dead-letters it.

Persisting an intent sends nothing. The existing fenced delivery worker
(P01-D2) is the only component that moves delivery state.

## Staff read API (`communications.notifications`)

| Route | Permission | Notes |
| --- | --- | --- |
| `GET notifications[?subjectType&subjectRef][&state][&limit][&cursor]` | `operations.dispatch` | `subjectType` and `subjectRef` must be given together. `state` is one of the nine delivery states. `limit` is 1-100. Keyset cursor, newest first |
| `GET notifications/:id` | `operations.dispatch` | Adds `attempts[]` with `attemptNo`, times, outcome and error code |

What the responses never include:

- the recipient reference;
- template parameters;
- the request hash, lease owner or fence;
- provider message ids.

Every response names Communications as the owner of delivery state and
Booking as the owner of the booking.

`communications.read` is requested (CR-D-P01-01). Until it exists, the
operations role reads. Finance, reviewers, technicians and customers get 403;
`super-admin` holds every permission.

Error statuses:

- `401`: no or unknown credential, or a forged forwarded subject;
- `403`;
- `404` for an unknown id;
- `422` with a stable code;
- `429` when the per-subject budget is spent (`COMMUNICATIONS_READS_PER_MINUTE`, default 120);
- `503` when Identity is unreachable or not configured.

Each read writes one audit line with the read, subject, correlation id and
decision. It never logs rows.

## Database (migration `20261010090000_p03d_notification_subject`)

The migration is additive:

- nullable `subject_type` and `subject_ref`;
- an index on `(subject_type, subject_ref)` and one on `(created_at, id)`;
- CHECK constraints:
  - both subject columns are set or both are null;
  - the subject type format.

Existing rows satisfy them. Previous code never writes the columns.

**Rollback:** redeploy the previous image. Dropping the columns is a separate,
reviewed step.

## Evidence

Command (exact final tree; acceptance stack from
`node scripts/dev/acceptance-infra.mjs up`):

```
pnpm generate && pnpm build
node scripts/production/D/run-real-infra.mjs --evidence docs/production/D/evidence/p03-d2-real-infra.json
```

| Dependency | Real? |
| --- | --- |
| PostgreSQL 16, with migration and runtime identities, hardening and a drift check | real |
| RabbitMQ 4.2, with a quorum queue, delivery limit, DLX/DLQ and ACLs | real, single node |
| Identity (Argon2, RS256, sessions, roles granted through its endpoint) | real; OTP delivery is captured in-process |
| Booking producer | **not real**: the infrastructure identity publishes the published contract shape |
| Delivery provider | **not real**: the declared scripted port in H1, because no provider account exists |

The suites:

- **E1:** the accepted ACL refuses the `booking.events` binding.
- **E2:** the real worker. It covers:
  - three identical deliveries produce one effect;
  - a republished confirmation is REPLAYED, so there is one intent;
  - a crash between commit and ACK gives a DUPLICATE;
  - a late confirmation is SKIPPED;
  - a rival customer and an unpublished shape are dead-lettered, with no
    inbox row and the original intent intact;
  - the logs contain no recipient reference;
  - the correlation id is carried into worker records.
- **S1:** CHECK refusals, and the runtime identity has no DDL or TRUNCATE.
- **H1:** the real HTTP adapter and the real Identity. It covers:
  - operations sees a booking's intent `QUEUED`;
  - after the real delivery worker runs, operations sees it
    `PROVIDER_ACCEPTED` (not "delivered"), with its attempt;
  - hidden fields are absent;
  - super-admin 200, finance 403, customer 403, anonymous 401, forged
    subject 401, 404 and 422.

Results on source `3e6030c` (tree `40b2eb5213a17dd14a0ab54f1d04a0343656bb33`, clean):

| Gate | Result |
| --- | --- |
| Lane D real-infrastructure gate (all Lane D suites on this branch, migrations, hardening, drift) | **53/53 PASSED** (`docs/production/D/evidence/p03-d2-real-infra.json`) |
| Communications unit and Nest specs | 37/37 PASSED |
| `node scripts/check-images.mjs communications` (boots without `IDENTITY_ORIGIN`) | 6/6 PASSED |
| `pnpm typecheck`, `pnpm test:unit` (558/558), `pnpm test:design-lock` (12/12) | PASSED |
| boundaries, migrations, ownership, ESLint, `prettier --check .` | PASSED |

## Not proven here (blockers)

- **CR-D-P03-07:** the `booking.events` topology and ACL; a Booking producer
  of `booking.confirmed.v1`; Customer contact preferences and recipient
  resolution.
- **CR-D-P03-06:** Gateway routes for the staff reads.
- `communications.read` (CR-D-P01-01).
- A real provider, its receipts and UNKNOWN reconciliation: an **external
  blocker**.
- Notifications for assignment and payment events wait for those contracts
  to be published (CR-D-P03-01).

## Next consumer

P03-D3, the admin console's booking detail: it shows the notification state
through the requested Gateway route.
