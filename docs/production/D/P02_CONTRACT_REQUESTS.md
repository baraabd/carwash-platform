# P02-D contract and dependency requests

Status: **SUBMITTED BY D / NOT ACCEPTED**. Lane D writes only its own scope. It
does not edit shared contracts, the Gateway, broker bootstrap, CI, lockfiles or
another lane's service. Each request below names the exact change. D consumes
only the merged, versioned result. Until a request merges, the dependent D
behavior stays fail-closed, as each row describes.

This file is byte-identical in the P02-D1 and P02-D2 pull requests, so they
merge in either order.

Base observed: `origin/main` `566d2e7435dac0803d075556fff43c435f8a29a7`
(tree `1bd162f2578878643b3e2c2cc437fece36716588`).

## CR-D-P02-01 (Lane E): Gateway support for operations reads

Findings on `main`:

- `routeMatch` rejects every URL that contains `?`. No GET route can carry
  filters or a page cursor.
- A route without `permission` is treated as not authenticated, so
  `verifiedHeaders` returns 401. A route cannot accept "any of" two
  permissions.

Requested changes (in `packages/contracts/src/gateway.ts` and
`apps/api-gateway/src/domain/policy.ts`):

1. `GatewayRoute.query?: readonly { name: string; pattern: string }[]`. This is
   an allowlist for GET routes. Unknown names, repeated names or values that
   fail the pattern return `400 REQUEST_INVALID`. Only the allowlisted
   parameters are re-encoded onto the upstream URL. A route without `query`
   keeps today's behavior (any `?` returns 404).
2. `GatewayRoute.anyPermission?: readonly IdentityPermission[]`. It is
   mutually exclusive with `permission`. The Gateway authenticates the request
   and requires at least one of the listed permissions.
3. Routes, all `GET`, owner `reporting`:

| Route id | Path | Upstream | Permission | Query allowlist |
| --- | --- | --- | --- | --- |
| `admin.operations.bookings` | `/admin/operations/bookings` | `/internal/v1/reporting/operations/bookings` | `operations.dispatch` | `from`, `to` (UTC instant), `zoneId` (uuid), `status` (closed enum), `limit` (1-100), `cursor` (`[A-Za-z0-9_-]{8,200}`) |
| `admin.operations.booking` | `/admin/operations/bookings/:id` | `/internal/v1/reporting/operations/bookings/:id` | `operations.dispatch` | none |
| `admin.operations.resources` | `/admin/operations/resources` | `/internal/v1/reporting/operations/resources` | any of `operations.dispatch`, `verification.review` | `eligibility`, `limit`, `cursor` |
| `admin.operations.freshness` | `/admin/operations/freshness` | `/internal/v1/reporting/operations/freshness` | any of `operations.dispatch`, `verification.review` | none |

4. Publish `reporting.operations.v1` in `@carwash/contracts`, with the response
   shapes documented in `P02-D1_REPORTING_OPERATIONS_PROJECTIONS.md`. Then add
   `@carwash/contracts: workspace:*` to `apps/admin-web` and to
   `services/reporting`. That is a lockfile change, so it belongs to E. The
   local strict readers in both packages are then deleted.

Interim behavior: on `main`, the admin console's operations reads get
`404 NOT_FOUND` from the Gateway. The console renders that as "service
unavailable" and never shows invented rows. The P02-D2 browser journeys run
on a candidate tree that applies the proposed change in
`P02_CANDIDATE_GATEWAY.patch`. That evidence is labelled as candidate
evidence, not as `main` evidence.

## CR-D-P02-02 (Lane E / Identity): read permission decision D-P02-01

Reporting authorizes operations reads with existing permissions whose meaning
matches the read:

- bookings: `operations.dispatch`;
- workforce eligibility and freshness: `operations.dispatch` or
  `verification.review`.

A reviewer therefore cannot browse bookings. If E and the owner prefer the
dedicated `reporting.read` from CR-D-P01-01, Reporting changes one constant
(`OPERATIONS_READS`). The decision is requested; it is not assumed.

## CR-D-P02-03 (Lane E + producer owners): business event topology

The consumer `services/reporting/src/inbox/operations-consumer.runner.ts`
binds the subscriber-owned queue `reporting.operations` to:

| Exchange (topic) | Routing key | Contract | Producer today |
| --- | --- | --- | --- |
| `booking.events` | `booking.confirmed.v1` | `@carwash/event-contracts` `parseBookingConfirmedV1` | none: Booking is a foundation shell |
| `scheduling.events` | `scheduling.hold-changed.v1` | `SCHEDULING_HOLD_CHANGED_V1` | Scheduling emits `scheduling.hold-created.v1` / `...expired.v1` in a local shape, not the published contract |
| `workforce.events` | `workforce.eligibility-changed.v1` | `WORKFORCE_ELIGIBILITY_CHANGED_V1` | Workforce emits a local envelope-v1 shape (`operatorId`, `eligible`, ...) under the same name; the published v2 contract refuses it |

Requested:

1. Declare the three exchanges in the shared bootstrap
   (`infra/rabbitmq/acceptance-bootstrap.sh`,
   `packages/platform-messaging/src/topology.ts`).
2. Change the `cw_reporting_app` read permission to exactly
   `^(reporting\.|catalog\.events$|booking\.events$|scheduling\.events$|workforce\.events$)`.
   Configure and write stay `^reporting\.`.
3. Producer owners emit the published contracts. Workforce's same-named local
   event must be reconciled with `workforce.eligibility-changed.v1`
   (`capacity-resource`, envelope v2): one of the two names must change.

Interim behavior: on the accepted ACL the worker's binding is refused with
`403`, and the suite proves it (B1). The worker does not start in any
deployment, and Reporting stays `BUSINESS_READY = false`. A delivered event in
the local Workforce shape is dead-lettered as a parse error and is never folded.

## CR-D-P02-04 (Lane C, Workforce owner): verification-case reads

The approved "طلبات الانضمام" panel needs to list cases. Workforce today has
only `POST /:id/review`, `POST me/verification-cases` and
`POST verification-cases/:id/withdraw`. It has no list and no single-case
read.

Requested:

- `GET /internal/v1/workforce/verification-cases?status=PENDING_REVIEW&limit&cursor`
  (permission `verification.review`). It returns `caseId`, `operatorId`,
  `status`, `submittedAt`, the count of evidence references, and `version`.
  Evidence bytes stay in Media.
- `GET /internal/v1/workforce/verification-cases/:id`, same permission.
- Gateway routes `admin.reviews.list` and `admin.reviews.get` (Lane E).

Interim behavior: the console opens a case by its reference and submits the
decision to the existing `admin.review` route. The pending-request count
shows "—", and the screen says the list is not available yet.

## CR-D-P02-05 (Booking owner): authoritative booking read for staff

The approved bookings table shows the customer, vehicle, package, technician
and payment. These are Booking/Dispatch facts. Reporting does not and must not
copy them.

Requested: a staff read `GET /internal/v1/booking/:id` with
`operations.dispatch`, plus a Gateway route. The console then fills those
columns from the owner and keeps the projection only for discovery.

Interim behavior: those columns render "—" with an explanatory title. The
detail dialog states that the authoritative read is not available yet.

## CR-D-P02-06 (Lane E): lint coverage for admin-web TypeScript

`eslint.config.mjs` matches `apps/admin-web/src/**/*.ts` only to add the
`document` global. No TypeScript parser applies there, so `pnpm lint` fails to
parse any real TypeScript in admin-web.

Requested: add `apps/admin-web/src/**/*.ts` to the type-aware block that
already covers `services/*/src/**/*.ts`. Keep the browser globals
(`document`, `window`, `location`, `localStorage`). The project service
resolves `apps/admin-web/tsconfig.json`.

Interim evidence: P02-D2 ran exactly that configuration as a local,
uncommitted overlay. It covered 16 files with 0 errors.
