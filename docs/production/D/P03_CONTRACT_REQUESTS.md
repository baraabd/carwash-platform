# P03-D contract and dependency requests

Status: **SUBMITTED BY D / NOT ACCEPTED**. Lane D writes only its own scope. It
does not edit shared contracts, the Gateway, Identity, broker bootstrap, CI,
lockfiles or another lane's service. Each request below names the exact
change. D consumes only the merged, versioned result. Until a request merges,
the dependent D behavior stays fail-closed, as each row describes.

This file is byte-identical in every P03-D child pull request, so the children
merge in any order.

Base observed: `origin/main` `a14997a20b85341a24f17e7878d2a188eea3fe36`
(tree `0261a7ede0bf05c02ef5eb1f56b2afe6cfabba6b`).

The P02-D requests (CR-D-P02-01 to CR-D-P02-06,
`P02_CONTRACT_REQUESTS.md`) are still open. P03-D depends on them as well.

## CR-D-P03-01 (Lane E): publish the Dispatch and Billing events Reporting folds

Requested:

1. Register these in `@carwash/event-contracts`, with parsers, exactly as the
   producers already write them:
   - `dispatch.assignment-changed.v1`
     (`docs/production/C/contract-requests/CR-P02-C3-dispatch-v1.md` §1);
   - `billing.obligation-created.v1` and
     `billing.obligation-status-changed.v1`
     (`docs/production/B/CONTRACT_REQUEST_E_BILLING.md`, CR-B-02).
2. Declare the `dispatch.events` and `washgo.billing.events` exchanges in the
   shared bootstrap, and extend the `cw_reporting_app` read permission
   (CR-D-P02-03) to them.
3. The Reporting mapping that D will add once (1) merges is:

| Event | Fact |
| --- | --- |
| `dispatch.assignment-changed.v1` | `assignmentFact({ eventId, occurredAt, version: aggregate.version, assignmentId: aggregate.id, ...data })` |
| `billing.obligation-created.v1` | `obligationFact({ obligationId: aggregate.id, version: aggregate.version, cashState: data.financialStatus, outstanding: data.amount })` |
| `billing.obligation-status-changed.v1` | `obligationFact({ ..., cashState: data.financialStatus, outstanding: data.outstanding })` |

Interim behavior: the consumer has no parser for these types, so a delivery
is dead-lettered as `UNSUPPORTED_EVENT`. The projector, tables and KPIs are
complete and are proven on real PostgreSQL by applying validated facts
(`tests/production/D/reporting-live-operations.test.mjs`).

## CR-D-P03-02 (Lane E): Gateway routes for the admin live-operations console

All of these depend on CR-D-P02-01 (query allowlist and `anyPermission`).

| Route id | Method and path | Upstream (owner) | Permission | Query allowlist / body |
| --- | --- | --- | --- | --- |
| `admin.operations.kpis` | GET `/admin/operations/kpis` | `/internal/v1/reporting/operations/kpis/operations` (reporting) | `operations.dispatch` | `from`, `to` (UTC instant), `zoneId` (uuid) |
| `admin.finance.cash` | GET `/admin/finance/cash` | `/internal/v1/reporting/operations/kpis/cash` (reporting) | `billing.read` | none |
| `admin.booking.get` | GET `/admin/bookings/:id` | `/internal/v1/booking/bookings/:id` (booking) | `operations.dispatch` | none (replaces CR-D-P02-05) |
| `admin.assignments.list` | GET `/admin/assignments` | `/internal/v1/dispatch/assignments` (dispatch) | `operations.dispatch` | `from`, `to`, `status`, `limit`, `cursor` per `dispatch.v1` |
| `admin.assignments.get` | GET `/admin/assignments/:id` | `/internal/v1/dispatch/assignments/:id` | `operations.dispatch` | none |
| `admin.assignments.byBooking` | GET `/admin/bookings/:id/assignment` | `/internal/v1/dispatch/bookings/:id/assignment` | `operations.dispatch` | none |
| `admin.assignments.offer` | POST `/admin/assignments/:id/offers` | `/internal/v1/dispatch/assignments/:id/offers` | `operations.dispatch` | body per `dispatch.v1`, `Idempotency-Key` |
| `admin.assignments.reassign` | POST `/admin/assignments/:id/reassign` | `/internal/v1/dispatch/assignments/:id/reassign` | `operations.dispatch` | same |
| `admin.assignments.unassign` | POST `/admin/assignments/:id/unassign` | `/internal/v1/dispatch/assignments/:id/unassign` | `operations.dispatch` | same |
| `admin.billing.obligation` | GET `/admin/billing/obligations/:id` | `/internal/v1/billing/obligations/:id` (billing) | `billing.read` | none |
| `admin.billing.reconcile` | POST `/admin/billing/payment-attempts/:id/reconciliation` | `/internal/v1/billing/payment-attempts/:id/reconciliation` | `billing.reconcile` | body per `billing.v1`, `Idempotency-Key` |

Also requested: the existing `admin.dispatch` and `admin.billing` routes point
at upstreams that do not exist (`/booking/:id/dispatch` and
`/billing/summary`). Retire them or repoint them.

Interim behavior: on `main` the console receives `404` from the Gateway for
every route above. It renders the "unavailable" state and never invents data.
Browser evidence runs on a declared candidate tree that applies the proposed
change from a patch file kept in `docs/production/D/`.

## CR-D-P03-03 (Lane C, Dispatch owner): field progress

Admin live status and the job-stage KPIs need field progress after
`ASSIGNED`: en route, arrived, washing and completed (or a failure reason).
Dispatch publishes none of these, and no other owner does.

Requested: a Dispatch-owned (or Workforce-owned) job-progress fact, with a
monotonic version per job and a published event
`dispatch.job-progress-changed.v1`, plus a staff read.

Interim behavior: Reporting answers
`fieldStages: {available: false, reason: "NO_PUBLISHED_SOURCE"}`. The console
shows the assignment status only and labels field progress as not available.

## CR-D-P03-04 (Lane B, Billing and Wallet owner): cash custody and booking linkage

1. Add `bookingId` to `billing.obligation-created.v1` data (and to the
   obligation read). Without it, a cash state cannot be joined to a booking.
2. Cash custody and settlement. On `main`, Wallet is a foundation shell and
   Billing has no custody route. **PR #111 (P03-B1, open, not merged)** adds
   custody to Billing's ledger:
   - finance reads: `GET custody/holders/:subject`, `GET custody/reconciliation`
     and `GET custody/handovers/:id`;
   - finance commands: `POST custody/handovers/:id/treasury-receipt` and
     `POST custody/handovers/:id/reconciliation`, with `Idempotency-Key` and
     an audit actor.

   D consumes these only after #111 merges and E publishes `billing.v1`
   with the Gateway aliases (B-P03-04). Their permissions,
   `billing.treasury.receive` and the others, are themselves requested
   (CR-B-08).

   One gap remains for the console: a staff list of handovers awaiting
   treasury receipt or reconciliation, so finance can discover them without
   knowing a reference.
3. `GET payment-attempts?status=PENDING_REVIEW|UNKNOWN&limit&cursor` with
   `billing.read`. The finance review queue needs to discover attempts, and
   today an attempt can only be read through its obligation.

Interim behavior: the finance console offers reconciliation of a payment
attempt by reference, through Billing's existing route. Custody and settlement
render as "not available: owner API pending". No button pretends to settle
cash.

## CR-D-P03-05 (Lane E / Identity): `billing.reconcile`

Billing requires `billing.reconcile` for reconciliation
(`services/billing/src/application/billing.service.ts`), but
`IDENTITY_PERMISSIONS` has no such permission. Therefore no role, not even
`super-admin`, can reconcile on `main`.

Requested: add `billing.reconcile` to `IDENTITY_PERMISSIONS` and grant it to
`finance`. `super-admin` follows automatically, because it holds every
permission. This is the same request as Lane B's CR-B-03.

**PR #109 (P03-E1, open, not merged)** implements exactly this. D needs no
change of its own; it consumes the merged permission.

Interim behavior: until #109 merges, the finance reconciliation action
receives `403` from Billing. The console shows "not permitted" and leaves the
attempt unchanged.

## CR-D-P03-06 (Lane E): notification read routes

| Route id | Method and path | Upstream (owner) | Permission |
| --- | --- | --- | --- |
| `admin.notifications.list` | GET `/admin/notifications` | `/internal/v1/communications/notifications` (communications) | `operations.dispatch` |
| `admin.notifications.get` | GET `/admin/notifications/:id` | `/internal/v1/communications/notifications/:id` | `operations.dispatch` |

The query allowlist is defined in `P03-D2_COMMUNICATIONS_EVENT_NOTIFICATIONS.md`.

## CR-D-P03-07 (Lane E + owners): event-notification topology and recipients

1. Declare `booking.events` in the shared bootstrap.
2. Extend the `cw_communications_app` read permission to exactly
   `^(communications\.|catalog\.events$|booking\.events$)`. Configure and
   write stay `^communications\.`.
3. Booking must emit the published `booking.confirmed.v1`. Today it emits
   only the unpublished `booking.created.v1` (CR-P02-C2).
4. The Customer owner must publish contact preferences: channel, and opt-out
   from transactional messages. The delivery adapter also needs a
   recipient-resolution read.

Until (4) exists, the confirmation intent uses SMS and resolves no address.
No provider exists either: that is an external blocker (P01-D2).

Interim behavior: on the accepted ACL, the worker's binding is refused with
`403` (suite E1). A delivered event in any other shape is dead-lettered.
